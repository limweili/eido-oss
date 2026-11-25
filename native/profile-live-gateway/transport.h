#ifndef EIDO_PROFILE_LIVE_GATEWAY_TRANSPORT_H
#define EIDO_PROFILE_LIVE_GATEWAY_TRANSPORT_H

#include <stddef.h>
#include <stdint.h>

#ifdef _WIN32
#include <windows.h>
typedef HANDLE eido_transport_handle;
#define EIDO_TRANSPORT_INVALID_HANDLE INVALID_HANDLE_VALUE
#else
typedef int eido_transport_handle;
#define EIDO_TRANSPORT_INVALID_HANDLE (-1)
#endif

enum eido_transport_connect_result {
  EIDO_TRANSPORT_CONNECTED = 0,
  EIDO_TRANSPORT_ENDPOINT_ABSENT = 1,
  EIDO_TRANSPORT_PEER_REJECTED = 2,
  EIDO_TRANSPORT_CONNECT_FAILED = 3
};

enum eido_transport_read_result {
  EIDO_TRANSPORT_READ_COMPLETE = 0,
  EIDO_TRANSPORT_READ_CLOSED = 1,
  EIDO_TRANSPORT_READ_TIMEOUT = 2,
  EIDO_TRANSPORT_READ_FAILED = 3
};

enum eido_transport_connect_result eido_transport_connect_verified(
  const char *endpoint,
  eido_transport_handle *handle
);
enum eido_transport_connect_result eido_transport_listen_verified(
  const char *endpoint,
  eido_transport_handle *listener
);
enum eido_transport_connect_result eido_transport_accept_verified(
  eido_transport_handle listener,
  eido_transport_handle *client
);
int eido_transport_prepare_standard_streams(void);
int eido_transport_read_exact(
  eido_transport_handle handle,
  uint8_t *buffer,
  size_t length
);
enum eido_transport_read_result eido_transport_read_exact_bounded(
  eido_transport_handle handle,
  uint8_t *buffer,
  size_t length,
  uint32_t timeout_milliseconds
);
int eido_transport_write_all(
  eido_transport_handle handle,
  const uint8_t *buffer,
  size_t length
);
void eido_transport_close(eido_transport_handle handle);
void eido_transport_disconnect_client(
  eido_transport_handle listener,
  eido_transport_handle client
);
void eido_transport_cleanup_endpoint(const char *endpoint);
void eido_transport_emergency_cleanup_endpoint(const char *endpoint);

#ifdef _WIN32
int eido_transport_create_current_user_pipe_security(
  SECURITY_ATTRIBUTES *attributes,
  PSECURITY_DESCRIPTOR *descriptor,
  PACL *acl
);
void eido_transport_free_pipe_security(
  PSECURITY_DESCRIPTOR descriptor,
  PACL acl
);
#endif

#endif
