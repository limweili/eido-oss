// Generate the packaged-app icons (macOS .iconset PNGs + Windows .ico sizes)
// from the canonical logo source. Run via scripts/design/generate-app-icons.sh.
//
// Composition: the Big Sur icon grid — an 824/1024 rounded rect on a
// transparent canvas — filled with the design system's canvas color
// (--surface-ground, #e8e4dc), with the logo mark centered on it. The mark is
// cropped to its content bounding box first: in the 1024px source the mark
// occupies only ~63% of the canvas width, and shipping that padding makes the
// icon render visibly smaller than every neighbor in the Dock.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write(Data("usage: generate-app-icons <source.png> <output-dir>\n".utf8))
  exit(2)
}
let sourceURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)

guard let src = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let full = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
  FileHandle.standardError.write(Data("cannot read \(sourceURL.path)\n".utf8))
  exit(1)
}

// Content bounding box of the mark in the 1024px source (measured; the source
// is 1024x1024 with the mark at x 190-830, y 118-883) plus a small margin so
// the outline's soft edge is not clipped.
let bbox = CGRect(x: 170, y: 98, width: 681, height: 806)
guard full.width == 1024, full.height == 1024, let mark = full.cropping(to: bbox) else {
  FileHandle.standardError.write(Data("source is not the expected 1024px logo\n".utf8))
  exit(1)
}

let ground = CGColor(red: 0xE8 / 255.0, green: 0xE4 / 255.0, blue: 0xDC / 255.0, alpha: 1)

func renderIcon(canvas: Int) -> CGImage {
  let s = CGFloat(canvas) / 1024.0
  let ctx = CGContext(
    data: nil, width: canvas, height: canvas, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high

  // Apple icon grid: 824x824 rounded rect centered in 1024, corner radius 185.
  let rect = CGRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
  let path = CGPath(roundedRect: rect, cornerWidth: 185 * s, cornerHeight: 185 * s, transform: nil)
  ctx.addPath(path)
  ctx.setFillColor(ground)
  ctx.fillPath()

  // Mark centered at 72% of the grid height, preserving its 681:806 aspect.
  let markHeight = 824 * 0.72 * s
  let markWidth = markHeight * bbox.width / bbox.height
  let markRect = CGRect(
    x: (CGFloat(canvas) - markWidth) / 2, y: (CGFloat(canvas) - markHeight) / 2,
    width: markWidth, height: markHeight)
  ctx.draw(mark, in: markRect)
  return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) {
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else {
    FileHandle.standardError.write(Data("failed to write \(url.path)\n".utf8))
    exit(1)
  }
}

try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

// macOS iconset slots. Each size is rendered fresh (vector rect + one
// high-quality image scale), not downsampled from 1024.
let iconsetDir = outDir.appendingPathComponent("icon.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconsetDir, withIntermediateDirectories: true)
let slots: [(String, Int)] = [
  ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]
var rendered: [Int: CGImage] = [:]
for (name, size) in slots {
  let image = rendered[size] ?? renderIcon(canvas: size)
  rendered[size] = image
  writePNG(image, to: iconsetDir.appendingPathComponent(name))
}

// Windows ICO member sizes, written as flat PNGs; the shell script packs them.
for size in [16, 24, 32, 48, 64, 128, 256] {
  let image = rendered[size] ?? renderIcon(canvas: size)
  rendered[size] = image
  writePNG(image, to: outDir.appendingPathComponent("ico-\(size).png"))
}
print("rendered iconset + ico members into \(outDir.path)")
