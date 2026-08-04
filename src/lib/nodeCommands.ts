import type { Host, Service, Vpn } from "../types";

/**
 * One button in a node's hover menu. `command` is empty for actions that
 * aren't a shell command at all (opening an interactive shell), which the
 * handler distinguishes on.
 */
export interface NodeAction {
  label: string;
  /** The exact text that will run; shown in full on hover. */
  command: string;
  /**
   * Short form shown under the label. Some commands have to resolve a
   * service to its real containers first and are too long to read at a
   * glance -- this is the gist, with `command` available on hover so what
   * actually runs is never hidden.
   */
  summary?: string;
  /** Opens the interactive shell instead of streaming a one-shot command. */
  shell?: boolean;
  run: () => void;
}

/**
 * Commands are built here rather than typed by the user, so they're fixed
 * strings with only the resource's own name interpolated -- and that name is
 * quoted, since it can come from an imported project file.
 */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Escapes a name for use inside a `--filter name=^…$` regex. */
function rx(s: string): string {
  return s.replace(/[.[\]{}()*+?^$|\\]/g, "\\$&");
}

/**
 * Shell that resolves a Docker *service* name to the container ids backing it
 * on this host, leaving them in `$ids`.
 *
 * This is needed because a service name is not a container name: Swarm names
 * each task container `<service>.<slot>.<taskid>`, so `docker logs web` or
 * `docker stats web` simply fail for a service called `web`. The link back is
 * the label Swarm stamps on every task container. Resolution happens at run
 * time rather than being stored on the Service record because task ids change
 * on every redeploy -- a stored container name would go stale immediately.
 *
 * Falls back to an exact-name match so plain, non-Swarm containers work too.
 */
function resolveContainers(name: string): string {
  return (
    `ids=$(docker ps -q --filter label=com.docker.swarm.service.name=${q(name)} 2>/dev/null); ` +
    `[ -z "$ids" ] && ids=$(docker ps -q --filter name=${q("^" + rx(name) + "$")} 2>/dev/null); ` +
    `[ -z "$ids" ] && { echo "no running container for ${name} on this host"; exit 1; }; `
  );
}

interface HostHandlers {
  onOpenShell: (hostId: string, hostName: string) => void;
  onRunCommand: (
    hostId: string,
    hostName: string,
    command: string,
    name: string,
  ) => void;
}

/** Quick looks at a host: what's running, what's full, what's broken. */
export function hostActions(host: Host, h: HostHandlers): NodeAction[] {
  const run = (label: string, command: string): NodeAction => ({
    label,
    command,
    run: () => h.onRunCommand(host.id, host.name, command, label),
  });

  return [
    {
      label: "Open shell",
      command: "",
      shell: true,
      run: () => h.onOpenShell(host.id, host.name),
    },
    run("Disk usage", "df -h"),
    run("Memory", "free -h"),
    run("Top processes", "ps aux --sort=-%cpu | head -15"),
    run("Docker containers", "docker ps"),
    run("Failed units", "systemctl --failed --no-pager"),
    run("Last logins", "last -n 10"),
  ];
}

/**
 * Service actions run against the service's own host -- the sidebar already
 * proves that pattern works, this just puts the common ones one click away.
 */
export function serviceActions(
  service: Service,
  host: Host | undefined,
  h: HostHandlers,
): NodeAction[] {
  if (!host) return [];
  const run = (label: string, command: string, summary?: string): NodeAction => ({
    label,
    command,
    summary,
    run: () => h.onRunCommand(host.id, host.name, command, `${service.name} — ${label}`),
  });
  const name = q(service.name);

  if (service.type === "Docker") {
    // Tasks and Inspect try the service-level command first and fall back to
    // the resolved containers, which is the only path that works on a worker
    // node where `docker service …` is refused. Logs goes straight to the
    // service form; Stats has no service form at all.
    const resolve = resolveContainers(service.name);
    return [
      run(
        "Tasks",
        `docker service ps --no-trunc ${name} 2>/dev/null || ` +
          `{ ${resolve}docker inspect --format '{{.Name}}  {{.State.Status}}  {{.Config.Image}}' $ids; }`,
        `docker service ps ${service.name}`,
      ),
      // Straight through, no container resolution: `docker service logs`
      // already aggregates every replica of the service.
      run("Logs", `docker service logs --tail 100 ${name}`),
      run(
        "Inspect",
        `docker service inspect --pretty ${name} 2>/dev/null || ` +
          `{ ${resolve}docker inspect $ids; }`,
        `docker service inspect ${service.name}`,
      ),
      // No service-level form exists: `docker stats` only ever takes
      // containers, so this always goes through resolution.
      run(
        "Stats",
        `${resolve}docker stats --no-stream $ids`,
        `docker stats (containers of ${service.name})`,
      ),
    ];
  }
  if (service.type === "LXC") {
    return [
      run("Info", `lxc info ${name}`),
      run("Processes", `lxc exec ${name} -- ps aux`),
      run("Console log", `lxc console --show-log ${name}`),
    ];
  }
  // Node (or anything hand-typed): no registry to query, so fall back to
  // finding the process by name.
  return [
    run("Find process", `ps aux | grep -i ${name} | grep -v grep`),
    run("Listening ports", "ss -ltnp"),
  ];
}

/** VPN actions target the container locally, not a remote host. */
export function vpnActions(
  vpn: Vpn,
  onDockerAction: (vpnId: string, action: "start" | "stop") => void,
): NodeAction[] {
  return [
    {
      label: "Start container",
      command: `docker start ${vpn.containerName}`,
      run: () => onDockerAction(vpn.id, "start"),
    },
    {
      label: "Stop container",
      command: `docker stop ${vpn.containerName}`,
      run: () => onDockerAction(vpn.id, "stop"),
    },
  ];
}
