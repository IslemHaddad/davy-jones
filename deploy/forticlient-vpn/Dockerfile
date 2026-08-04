FROM ubuntu:22.04

# ca-certificates is the important one, and was the gap that made a pinned
# --trusted-cert look necessary: without a CA bundle openfortivpn cannot
# validate ANY gateway certificate, including a perfectly good one, so every
# connection failed until a digest was hardcoded to bypass validation.
#
# netcat-openbsd rather than the netcat metapackage: davy-jones runs
# `docker exec <container> nc -vz <ip> <port>` for its reachability checks
# and needs the BSD flags specifically. iputils-ping, openssh-client and
# rsync are likewise there for exec'd diagnostics, not for the tunnel.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        openfortivpn \
        sudo \
        iputils-ping \
        netcat-openbsd \
        openssh-client \
        curl \
        rsync && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash vpnuser

# Scoped to the one command that actually needs root. The tunnel needs
# NOPASSWD (there is no one to type a password for a detached container), but
# that is not a reason for it to extend to every binary in the image -- the
# exec'd diagnostics above all run unprivileged.
RUN echo 'vpnuser ALL=(root) NOPASSWD: /usr/bin/openfortivpn' \
        > /etc/sudoers.d/openfortivpn && \
    chmod 440 /etc/sudoers.d/openfortivpn && \
    visudo -cf /etc/sudoers.d/openfortivpn

RUN mkdir -p /home/vpnuser/.config/openfortivpn && \
    chown -R vpnuser:vpnuser /home/vpnuser/.config

COPY entrypoint.sh /home/vpnuser/entrypoint.sh
RUN chmod +x /home/vpnuser/entrypoint.sh

USER vpnuser
WORKDIR /home/vpnuser

# ENTRYPOINT, not CMD: davy-jones provisions this image with `docker run -d`
# and no trailing command, so with `CMD ["/bin/bash"]` the container started a
# shell, read EOF on stdin and exited immediately -- which is why one shows
# as "exited" in the UI rather than holding a tunnel.
ENTRYPOINT ["/home/vpnuser/entrypoint.sh"]
