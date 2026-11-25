#include "transport.h"

#include <errno.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

int eido_transport_prepare_standard_streams(void) {
  return signal(SIGPIPE, SIG_IGN) != SIG_ERR;
}

static int owner_only_socket(const struct stat *status) {
  return S_ISSOCK(status->st_mode)
    && status->st_uid == geteuid()
    && (status->st_mode & 0077) == 0;
}

static int owner_only_parent(const char *endpoint) {
  char parent[sizeof(((struct sockaddr_un *)0)->sun_path)];
  char *separator;
  struct stat status;
  size_t length = strlen(endpoint);
  if (length == 0U || length >= sizeof(parent)) return 0;
  memcpy(parent, endpoint, length + 1U);
  separator = strrchr(parent, '/');
  if (separator == NULL) return 0;
  if (separator == parent) {
    separator[1] = '\0';
  } else {
    *separator = '\0';
  }
  return lstat(parent, &status) == 0
    && S_ISDIR(status.st_mode)
    && status.st_uid == geteuid()
    && (status.st_mode & 0077) == 0
    && (status.st_mode & 0700) == 0700;
}

enum eido_transport_connect_result eido_transport_connect_verified(
  const char *endpoint,
  eido_transport_handle *handle
) {
  struct stat endpoint_status;
  struct sockaddr_un address;
  size_t endpoint_length;
  uid_t peer_user;
  gid_t peer_group;
  int socket_handle;
  if (endpoint == NULL || handle == NULL) return EIDO_TRANSPORT_CONNECT_FAILED;
  endpoint_length = strlen(endpoint);
  if (endpoint_length == 0U || endpoint_length >= sizeof(address.sun_path)) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  if (lstat(endpoint, &endpoint_status) != 0) {
    return errno == ENOENT
      ? EIDO_TRANSPORT_ENDPOINT_ABSENT
      : EIDO_TRANSPORT_CONNECT_FAILED;
  }
  if (!owner_only_socket(&endpoint_status)) {
    return EIDO_TRANSPORT_PEER_REJECTED;
  }
  socket_handle = socket(AF_UNIX, SOCK_STREAM, 0);
  if (socket_handle < 0) return EIDO_TRANSPORT_CONNECT_FAILED;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, endpoint, endpoint_length + 1U);
  if (connect(
    socket_handle,
    (const struct sockaddr *)&address,
    (socklen_t)(offsetof(struct sockaddr_un, sun_path) + endpoint_length + 1U)
  ) != 0) {
    int connect_error = errno;
    close(socket_handle);
    return connect_error == ENOENT
      ? EIDO_TRANSPORT_ENDPOINT_ABSENT
      : EIDO_TRANSPORT_CONNECT_FAILED;
  }
  if (getpeereid(socket_handle, &peer_user, &peer_group) != 0
    || peer_user != geteuid()) {
    close(socket_handle);
    return EIDO_TRANSPORT_PEER_REJECTED;
  }
  *handle = socket_handle;
  return EIDO_TRANSPORT_CONNECTED;
}

enum eido_transport_connect_result eido_transport_listen_verified(
  const char *endpoint,
  eido_transport_handle *listener
) {
  struct sockaddr_un address;
  struct stat endpoint_status;
  size_t endpoint_length;
  int socket_handle;
  mode_t prior_mask;
  if (endpoint == NULL || listener == NULL || !owner_only_parent(endpoint)) {
    return EIDO_TRANSPORT_PEER_REJECTED;
  }
  endpoint_length = strlen(endpoint);
  if (endpoint_length == 0U || endpoint_length >= sizeof(address.sun_path)) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  if (lstat(endpoint, &endpoint_status) == 0) {
    int probe;
    if (!owner_only_socket(&endpoint_status)) return EIDO_TRANSPORT_PEER_REJECTED;
    probe = socket(AF_UNIX, SOCK_STREAM, 0);
    if (probe < 0) return EIDO_TRANSPORT_CONNECT_FAILED;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, endpoint, endpoint_length + 1U);
    if (connect(
      probe,
      (const struct sockaddr *)&address,
      (socklen_t)(offsetof(struct sockaddr_un, sun_path) + endpoint_length + 1U)
    ) == 0) {
      close(probe);
      return EIDO_TRANSPORT_CONNECT_FAILED;
    }
    {
      int probe_error = errno;
      close(probe);
      if (probe_error != ECONNREFUSED) return EIDO_TRANSPORT_CONNECT_FAILED;
    }
    if (unlink(endpoint) != 0) return EIDO_TRANSPORT_CONNECT_FAILED;
  } else if (errno != ENOENT) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  socket_handle = socket(AF_UNIX, SOCK_STREAM, 0);
  if (socket_handle < 0) return EIDO_TRANSPORT_CONNECT_FAILED;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, endpoint, endpoint_length + 1U);
  prior_mask = umask(0077);
  if (bind(
    socket_handle,
    (const struct sockaddr *)&address,
    (socklen_t)(offsetof(struct sockaddr_un, sun_path) + endpoint_length + 1U)
  ) != 0) {
    (void)umask(prior_mask);
    close(socket_handle);
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  (void)umask(prior_mask);
  if (chmod(endpoint, 0600) != 0
    || lstat(endpoint, &endpoint_status) != 0
    || !owner_only_socket(&endpoint_status)
    || (endpoint_status.st_mode & 0777) != 0600
    || listen(socket_handle, 16) != 0) {
    close(socket_handle);
    (void)unlink(endpoint);
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  *listener = socket_handle;
  return EIDO_TRANSPORT_CONNECTED;
}

enum eido_transport_connect_result eido_transport_accept_verified(
  eido_transport_handle listener,
  eido_transport_handle *client
) {
  uid_t peer_user;
  gid_t peer_group;
  int accepted;
  if (client == NULL) return EIDO_TRANSPORT_CONNECT_FAILED;
  do {
    accepted = accept(listener, NULL, NULL);
  } while (accepted < 0 && errno == EINTR);
  if (accepted < 0) return EIDO_TRANSPORT_CONNECT_FAILED;
  if (getpeereid(accepted, &peer_user, &peer_group) != 0
    || peer_user != geteuid()) {
    close(accepted);
    return EIDO_TRANSPORT_PEER_REJECTED;
  }
  *client = accepted;
  return EIDO_TRANSPORT_CONNECTED;
}

int eido_transport_read_exact(
  eido_transport_handle handle,
  uint8_t *buffer,
  size_t length
) {
  size_t offset = 0U;
  while (offset < length) {
    ssize_t read_count = read(handle, buffer + offset, length - offset);
    if (read_count > 0) {
      offset += (size_t)read_count;
    } else if (read_count == 0) {
      return 0;
    } else if (errno != EINTR) {
      return 0;
    }
  }
  return 1;
}

static int monotonic_milliseconds(uint64_t *milliseconds) {
  struct timespec now;
  if (milliseconds == NULL || clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
    return 0;
  }
  *milliseconds = ((uint64_t)now.tv_sec * 1000U)
    + ((uint64_t)now.tv_nsec / 1000000U);
  return 1;
}

enum eido_transport_read_result eido_transport_read_exact_bounded(
  eido_transport_handle handle,
  uint8_t *buffer,
  size_t length,
  uint32_t timeout_milliseconds
) {
  struct pollfd readable;
  uint64_t started;
  uint64_t deadline;
  size_t offset = 0U;
  if (handle < 0
    || buffer == NULL
    || length == 0U
    || timeout_milliseconds == 0U
    || !monotonic_milliseconds(&started)) {
    return EIDO_TRANSPORT_READ_FAILED;
  }
  deadline = started + (uint64_t)timeout_milliseconds;
  readable.fd = handle;
  readable.events = POLLIN;
  readable.revents = 0;
  while (offset < length) {
    uint64_t now;
    uint64_t remaining;
    int poll_timeout;
    int poll_result;
    ssize_t read_count;
    if (!monotonic_milliseconds(&now)) return EIDO_TRANSPORT_READ_FAILED;
    if (now >= deadline) return EIDO_TRANSPORT_READ_TIMEOUT;
    remaining = deadline - now;
    poll_timeout = remaining > (uint64_t)INT_MAX
      ? INT_MAX
      : (int)remaining;
    poll_result = poll(&readable, 1U, poll_timeout);
    if (poll_result < 0 && errno == EINTR) continue;
    if (poll_result == 0) return EIDO_TRANSPORT_READ_TIMEOUT;
    if (poll_result < 0 || (readable.revents & (POLLERR | POLLNVAL)) != 0) {
      return EIDO_TRANSPORT_READ_FAILED;
    }
    read_count = read(handle, buffer + offset, length - offset);
    if (read_count > 0) {
      offset += (size_t)read_count;
    } else if (read_count == 0) {
      return EIDO_TRANSPORT_READ_CLOSED;
    } else if (errno != EINTR) {
      return EIDO_TRANSPORT_READ_FAILED;
    }
    readable.revents = 0;
  }
  return EIDO_TRANSPORT_READ_COMPLETE;
}

int eido_transport_write_all(
  eido_transport_handle handle,
  const uint8_t *buffer,
  size_t length
) {
  size_t offset = 0U;
  while (offset < length) {
    ssize_t write_count = write(handle, buffer + offset, length - offset);
    if (write_count > 0) {
      offset += (size_t)write_count;
    } else if (write_count < 0 && errno == EINTR) {
      continue;
    } else {
      return 0;
    }
  }
  return 1;
}

void eido_transport_close(eido_transport_handle handle) {
  if (handle >= 0) close(handle);
}

void eido_transport_disconnect_client(
  eido_transport_handle listener,
  eido_transport_handle client
) {
  (void)listener;
  eido_transport_close(client);
}

void eido_transport_cleanup_endpoint(const char *endpoint) {
  struct stat status;
  if (endpoint != NULL
    && lstat(endpoint, &status) == 0
    && owner_only_socket(&status)) {
    (void)unlink(endpoint);
  }
}

void eido_transport_emergency_cleanup_endpoint(const char *endpoint) {
  if (endpoint != NULL) (void)unlink(endpoint);
}
