#include "transport.h"

#include <stdio.h>
#include <string.h>
#ifndef _WIN32
#include <signal.h>
#include <unistd.h>
#endif

#define EIDO_HELPER_VERSION "1"
#define EIDO_MAX_FRAME_BYTES (512U * 1024U)
#define EIDO_SERVER_CLIENT_READ_TIMEOUT_MS 5000U
#define EIDO_EXIT_USAGE 2
#define EIDO_EXIT_ENDPOINT_ABSENT 20
#define EIDO_EXIT_PEER_REJECTED 21
#define EIDO_EXIT_TRANSPORT_FAILED 22
#define EIDO_EXIT_INVALID_FRAME 23
#define EIDO_TERMINAL_FRAME_LENGTH 0xfffffffeU
#define EIDO_TERMINAL_ACK_LENGTH 0xfffffffdU

static uint8_t frame_payload[EIDO_MAX_FRAME_BYTES];
static const char *active_server_endpoint = NULL;

#ifndef _WIN32
static void terminate_server(int signal_number) {
  (void)signal_number;
  if (active_server_endpoint != NULL) {
    eido_transport_emergency_cleanup_endpoint(active_server_endpoint);
  }
  _exit(0);
}
#endif

static uint32_t decode_length(const uint8_t header[4]) {
  return ((uint32_t)header[0] << 24U)
    | ((uint32_t)header[1] << 16U)
    | ((uint32_t)header[2] << 8U)
    | (uint32_t)header[3];
}

static int read_standard_input_header(uint8_t header[4]) {
  size_t read_count = fread(header, 1U, 4U, stdin);
  if (read_count == 0U && feof(stdin)) return 0;
  return read_count == 4U ? 1 : -1;
}

static int write_standard_output(
  const uint8_t *buffer,
  size_t length
) {
  return fwrite(buffer, 1U, length, stdout) == length && fflush(stdout) == 0;
}

static int write_server_control(int opened) {
  static const uint8_t connection_opened[4] = {0U, 0U, 0U, 0U};
  static const uint8_t connection_closed[4] = {0xffU, 0xffU, 0xffU, 0xffU};
  return write_standard_output(
    opened ? connection_opened : connection_closed,
    sizeof(connection_opened)
  );
}

static int relay_frames(eido_transport_handle handle) {
  uint8_t header[4];
  for (;;) {
    int input_status = read_standard_input_header(header);
    uint32_t payload_length;
    int terminal_response = 0;
    if (input_status == 0) return 0;
    if (input_status < 0) return EIDO_EXIT_INVALID_FRAME;
    payload_length = decode_length(header);
    if (payload_length == 0U || payload_length > EIDO_MAX_FRAME_BYTES) {
      return EIDO_EXIT_INVALID_FRAME;
    }
    if (fread(frame_payload, 1U, payload_length, stdin) != payload_length) {
      return EIDO_EXIT_INVALID_FRAME;
    }
    if (!eido_transport_write_all(handle, header, sizeof(header))
      || !eido_transport_write_all(handle, frame_payload, payload_length)) {
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
    if (!eido_transport_read_exact(handle, header, sizeof(header))) {
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
    payload_length = decode_length(header);
    if (payload_length == EIDO_TERMINAL_FRAME_LENGTH) {
      terminal_response = 1;
      if (!eido_transport_read_exact(handle, header, sizeof(header))) {
        return EIDO_EXIT_TRANSPORT_FAILED;
      }
      payload_length = decode_length(header);
    }
    if (payload_length == 0U || payload_length > EIDO_MAX_FRAME_BYTES) {
      return EIDO_EXIT_INVALID_FRAME;
    }
    if (!eido_transport_read_exact(handle, frame_payload, payload_length)) {
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
    if (!write_standard_output(header, sizeof(header))
      || !write_standard_output(frame_payload, payload_length)) {
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
    if (terminal_response) {
      static const uint8_t terminal_ack[4] = {0xffU, 0xffU, 0xffU, 0xfdU};
      return eido_transport_write_all(handle, terminal_ack, sizeof(terminal_ack))
        ? 0
        : EIDO_EXIT_TRANSPORT_FAILED;
    }
  }
}

enum server_session_result {
  SERVER_SESSION_COMPLETE = 0,
  SERVER_PARENT_CLOSED = 1,
  SERVER_PARENT_FAILED = 2
};

static enum server_session_result relay_server_session(
  eido_transport_handle client
) {
  uint8_t header[4];
  for (;;) {
    uint32_t payload_length;
    int close_after_write = 0;
    int input_status;
    if (eido_transport_read_exact_bounded(
      client,
      header,
      sizeof(header),
      EIDO_SERVER_CLIENT_READ_TIMEOUT_MS
    ) != EIDO_TRANSPORT_READ_COMPLETE) {
      return SERVER_SESSION_COMPLETE;
    }
    payload_length = decode_length(header);
    if (payload_length == 0U || payload_length > EIDO_MAX_FRAME_BYTES) {
      return SERVER_SESSION_COMPLETE;
    }
    if (eido_transport_read_exact_bounded(
      client,
      frame_payload,
      payload_length,
      EIDO_SERVER_CLIENT_READ_TIMEOUT_MS
    ) != EIDO_TRANSPORT_READ_COMPLETE) {
      return SERVER_SESSION_COMPLETE;
    }
    if (!write_standard_output(header, sizeof(header))
      || !write_standard_output(frame_payload, payload_length)) {
      return SERVER_PARENT_FAILED;
    }
    input_status = read_standard_input_header(header);
    if (input_status == 0) return SERVER_PARENT_CLOSED;
    if (input_status < 0) return SERVER_PARENT_FAILED;
    payload_length = decode_length(header);
    if (payload_length == EIDO_TERMINAL_FRAME_LENGTH) {
      close_after_write = 1;
      input_status = read_standard_input_header(header);
      if (input_status == 0) return SERVER_PARENT_CLOSED;
      if (input_status < 0) return SERVER_PARENT_FAILED;
      payload_length = decode_length(header);
    }
    if (payload_length == 0U) return SERVER_SESSION_COMPLETE;
    if (payload_length > EIDO_MAX_FRAME_BYTES) {
      return SERVER_PARENT_FAILED;
    }
    if (fread(frame_payload, 1U, payload_length, stdin) != payload_length) {
      return SERVER_PARENT_FAILED;
    }
    if (close_after_write) {
      static const uint8_t terminal_marker[4] = {0xffU, 0xffU, 0xffU, 0xfeU};
      if (!eido_transport_write_all(
        client,
        terminal_marker,
        sizeof(terminal_marker)
      )) {
        return SERVER_SESSION_COMPLETE;
      }
    }
    if (!eido_transport_write_all(client, header, sizeof(header))
      || !eido_transport_write_all(client, frame_payload, payload_length)) {
      return SERVER_SESSION_COMPLETE;
    }
    if (close_after_write) {
      /* The client acknowledges only after consuming the terminal response,
         so Win32 can disconnect without discarding unread denial bytes. */
      enum eido_transport_read_result ack_result =
        eido_transport_read_exact_bounded(
        client,
        header,
        sizeof(header),
        EIDO_SERVER_CLIENT_READ_TIMEOUT_MS
      );
      if (ack_result != EIDO_TRANSPORT_READ_COMPLETE
        || decode_length(header) != EIDO_TERMINAL_ACK_LENGTH) {
        return SERVER_SESSION_COMPLETE;
      }
      return SERVER_SESSION_COMPLETE;
    }
  }
}

static int serve_frames(const char *endpoint) {
  eido_transport_handle listener = EIDO_TRANSPORT_INVALID_HANDLE;
  enum eido_transport_connect_result listen_result;
  listen_result = eido_transport_listen_verified(endpoint, &listener);
  if (listen_result == EIDO_TRANSPORT_PEER_REJECTED) {
    return EIDO_EXIT_PEER_REJECTED;
  }
  if (listen_result != EIDO_TRANSPORT_CONNECTED) {
    return EIDO_EXIT_TRANSPORT_FAILED;
  }
  active_server_endpoint = endpoint;
#ifndef _WIN32
  if (signal(SIGINT, terminate_server) == SIG_ERR
    || signal(SIGTERM, terminate_server) == SIG_ERR) {
    eido_transport_close(listener);
    eido_transport_cleanup_endpoint(endpoint);
    active_server_endpoint = NULL;
    return EIDO_EXIT_TRANSPORT_FAILED;
  }
#endif
  if (fputs("ready\n", stderr) == EOF || fflush(stderr) != 0) {
    eido_transport_close(listener);
    eido_transport_cleanup_endpoint(endpoint);
    active_server_endpoint = NULL;
    return EIDO_EXIT_TRANSPORT_FAILED;
  }
  for (;;) {
    eido_transport_handle client = EIDO_TRANSPORT_INVALID_HANDLE;
    enum eido_transport_connect_result accepted = eido_transport_accept_verified(
      listener,
      &client
    );
    enum server_session_result session_result;
    if (accepted == EIDO_TRANSPORT_PEER_REJECTED) continue;
    if (accepted != EIDO_TRANSPORT_CONNECTED) {
      eido_transport_close(listener);
      eido_transport_cleanup_endpoint(endpoint);
      active_server_endpoint = NULL;
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
    if (!write_server_control(1)) {
      eido_transport_cleanup_endpoint(endpoint);
      eido_transport_close(listener);
      active_server_endpoint = NULL;
      eido_transport_disconnect_client(listener, client);
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
    session_result = relay_server_session(client);
    if (session_result != SERVER_SESSION_COMPLETE) {
      /* Withdraw the endpoint before the peer observes EOF. A pre-admission
         client can then safely re-resolve once and prove absence. */
      eido_transport_cleanup_endpoint(endpoint);
      eido_transport_close(listener);
      active_server_endpoint = NULL;
      eido_transport_disconnect_client(listener, client);
      return session_result == SERVER_PARENT_CLOSED
        ? 0
        : EIDO_EXIT_INVALID_FRAME;
    }
    eido_transport_disconnect_client(listener, client);
    if (!write_server_control(0)) {
      eido_transport_close(listener);
      eido_transport_cleanup_endpoint(endpoint);
      active_server_endpoint = NULL;
      return EIDO_EXIT_TRANSPORT_FAILED;
    }
  }
}

static int run_client(const char *endpoint) {
  enum eido_transport_connect_result connect_result;
  eido_transport_handle handle = EIDO_TRANSPORT_INVALID_HANDLE;
  int result;
  connect_result = eido_transport_connect_verified(endpoint, &handle);
  if (connect_result == EIDO_TRANSPORT_ENDPOINT_ABSENT) {
    return EIDO_EXIT_ENDPOINT_ABSENT;
  }
  if (connect_result == EIDO_TRANSPORT_PEER_REJECTED) {
    return EIDO_EXIT_PEER_REJECTED;
  }
  if (connect_result != EIDO_TRANSPORT_CONNECTED) {
    return EIDO_EXIT_TRANSPORT_FAILED;
  }
  result = relay_frames(handle);
  eido_transport_close(handle);
  return result;
}

int main(int argument_count, char **arguments) {
  if (argument_count == 2 && strcmp(arguments[1], "--version") == 0) {
    puts("eido-profile-live-gateway-helper " EIDO_HELPER_VERSION);
    return 0;
  }
  if (argument_count != 3
    || (strcmp(arguments[1], "--client") != 0
      && strcmp(arguments[1], "--server") != 0)
    || arguments[2][0] == '\0') {
    return EIDO_EXIT_USAGE;
  }
#ifdef _WIN32
  fflush(stderr);
#endif
  if (!eido_transport_prepare_standard_streams()) {
    return EIDO_EXIT_TRANSPORT_FAILED;
  }
#ifdef _WIN32
  fflush(stderr);
#endif
  return strcmp(arguments[1], "--server") == 0
    ? serve_frames(arguments[2])
    : run_client(arguments[2]);
}
