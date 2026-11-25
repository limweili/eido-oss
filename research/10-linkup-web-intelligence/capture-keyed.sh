#!/usr/bin/env bash
# The keyed half of the live capture (03-live-capture.md). Run with a real key:
#
#   LINKUP_API_KEY=lk-... ./capture-keyed.sh
#
# Records every response verbatim into ./captures/<timestamp>/ next to this
# script. Total spend is well under one dollar: two deep searches ($0.05 each),
# a handful of standard and fast searches ($0.005 each), two fetches ($0.005
# each). Nothing here touches an Eido Profile.
set -euo pipefail

if [ -z "${LINKUP_API_KEY:-}" ]; then
  echo "Set LINKUP_API_KEY. This script refuses to look for a key anywhere else." >&2
  exit 1
fi

BASE="https://api.linkup.so/v1"
AUTH="Authorization: Bearer ${LINKUP_API_KEY}"
JSON="Content-Type: application/json"
OUT="$(cd "$(dirname "$0")" && pwd)/captures/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
echo "Recording into $OUT"

req() { # name, then curl args
  local name="$1"; shift
  curl -sS -D "$OUT/$name.headers" -o "$OUT/$name.body" -w '%{http_code}' "$@" || true
}

balance() {
  curl -sS -H "$AUTH" "$BASE/credits/balance"
}

# 4. Successful shapes: search at each depth the epic uses, fetch HTML, fetch PDF.
echo "search standard: $(req search-standard -X POST "$BASE/search" -H "$AUTH" -H "$JSON" \
  -d '{"q":"Which women have been awarded the Physics Nobel Prize","depth":"standard","outputType":"searchResults"}')"
sleep 2
echo "search deep:     $(req search-deep -X POST "$BASE/search" -H "$AUTH" -H "$JSON" --max-time 60 \
  -d '{"q":"What changed between the last two major TypeScript releases","depth":"deep","outputType":"searchResults"}')"
sleep 2
echo "fetch html:      $(req fetch-html -X POST "$BASE/fetch" -H "$AUTH" -H "$JSON" \
  -d '{"url":"https://example.com","renderJs":true}')"
sleep 2
echo "fetch pdf:       $(req fetch-pdf -X POST "$BASE/fetch" -H "$AUTH" -H "$JSON" --max-time 60 \
  -d '{"url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf","renderJs":false}')"
sleep 2

# 3. The no-result 400 body, verbatim. A gibberish query fenced to one domain.
echo "no result:       $(req no-result -X POST "$BASE/search" -H "$AUTH" -H "$JSON" \
  -d '{"q":"zxqvwv plomtrk unfindable nonsense token","depth":"standard","outputType":"searchResults","includeDomains":["example.com"]}')"
sleep 2

# 2. The authenticated 429 body, verbatim: burst past 10 requests in a second
# with the cheapest depth. Expect a mix of 200s and at least one 429.
echo "burst for 429 (15 fast searches in parallel):"
for i in $(seq 1 15); do
  req "burst-$i" -X POST "$BASE/search" -H "$AUTH" -H "$JSON" \
    -d '{"q":"time in paris","depth":"fast","outputType":"searchResults"}' >/dev/null &
done
wait
grep -l '"statusCode":429' "$OUT"/burst-*.body 2>/dev/null \
  && echo "  429 captured, see files above" \
  || echo "  no 429 seen; raise the burst size and rerun"

# 1. THE question: is an aborted call still billed? A deep search bills $0.05,
# so the delta is visible in the balance. curl is killed two seconds in, long
# before a 5-to-30s deep search can finish.
echo "balance before abort test:" | tee "$OUT/abort-billing.txt"
balance | tee -a "$OUT/abort-billing.txt"; echo | tee -a "$OUT/abort-billing.txt"
curl -sS -o /dev/null -X POST "$BASE/search" -H "$AUTH" -H "$JSON" --max-time 2 \
  -d '{"q":"a deliberately broad question about the entire history of aviation","depth":"deep","outputType":"searchResults"}' \
  || echo "aborted after 2s as intended" | tee -a "$OUT/abort-billing.txt"
echo "waiting 90s for any deferred billing to settle" | tee -a "$OUT/abort-billing.txt"
sleep 90
echo "balance after abort test:" | tee -a "$OUT/abort-billing.txt"
balance | tee -a "$OUT/abort-billing.txt"; echo | tee -a "$OUT/abort-billing.txt"
echo "If the two balances differ by 0.05, an aborted call IS billed."
echo "If they are equal, aborting also stops the spend."

echo "Done. Fold the verbatim bodies into 03-live-capture.md and pin the exact"
echo "429 and no-result codes in src/brain/linkup.test.ts if they differ."
