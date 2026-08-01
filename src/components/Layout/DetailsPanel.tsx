import { SquareTerminal, Trash2 } from "lucide-react";
import type {
  Credential,
  Host,
  SavedCommand,
  SelectedNode,
  Service,
  Vpn,
} from "../../types";
import { SshTerminal } from "../Terminal/SshTerminal";
import { SavedCommandsPanel } from "../Terminal/SavedCommandsPanel";
import { VpnDiagnostics } from "../Vpn/VpnDiagnostics";

interface DetailsPanelProps {
  selected: SelectedNode | null;
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
  savedCommands: SavedCommand[];
  onDeleteVpn: (id: string) => void;
  onDeleteHost: (id: string) => void;
  onDeleteService: (id: string) => void;
  onCreateSavedCommand: (cmd: Omit<SavedCommand, "id">) => Promise<void>;
  onDeleteSavedCommand: (id: string) => void;
  onOpenShell: (hostId: string, hostName: string) => void;
  onRunCommand: (
    hostId: string,
    hostName: string,
    command: string,
    name: string,
  ) => void;
}

export function DetailsPanel({
  selected,
  vpns,
  hosts,
  services,
  credentials,
  savedCommands,
  onDeleteVpn,
  onDeleteHost,
  onDeleteService,
  onCreateSavedCommand,
  onDeleteSavedCommand,
  onOpenShell,
  onRunCommand,
}: DetailsPanelProps) {
  if (!selected) {
    return (
      <p className="px-1 text-xs text-ink-faint">
        Select a VPN, host, or service on the canvas to view its details and
        available actions.
      </p>
    );
  }

  if (selected.kind === "vpn") {
    const vpn = vpns.find((v) => v.id === selected.id);
    if (!vpn) return null;
    return (
      <div className="flex flex-col gap-4">
        <Header title={vpn.name} onDelete={() => onDeleteVpn(vpn.id)} />
        <VpnDiagnostics vpn={vpn} />
      </div>
    );
  }

  if (selected.kind === "host") {
    const host = hosts.find((h) => h.id === selected.id);
    if (!host) return null;
    const credential = credentials.find((c) => c.id === host.credentialId);
    const vpn = vpns.find((v) => v.id === host.vpnId);
    const hostCommands = savedCommands.filter((c) => c.hostId === host.id);
    return (
      <div className="flex flex-col gap-4">
        <Header title={host.name} onDelete={() => onDeleteHost(host.id)} />
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-ink-faint">IP Address</dt>
          <dd className="text-right font-mono text-ink">{host.ip}</dd>
          <dt className="text-ink-faint">SSH Port</dt>
          <dd className="text-right font-mono text-ink">{host.port ?? 22}</dd>
          <dt className="text-ink-faint">Credential</dt>
          <dd className="text-right text-ink">
            {credential?.name ?? "—"}
          </dd>
          <dt className="text-ink-faint">VPN</dt>
          <dd className="text-right text-ink">{vpn?.name ?? "None"}</dd>
        </dl>

        <button
          onClick={() => onOpenShell(host.id, host.name)}
          className="flex items-center justify-center gap-1.5 rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-card"
        >
          <SquareTerminal size={13} />
          Open Interactive Shell
        </button>

        <SavedCommandsPanel
          hostId={host.id}
          commands={hostCommands}
          onCreate={onCreateSavedCommand}
          onDelete={onDeleteSavedCommand}
          onRun={(command, name) =>
            onRunCommand(host.id, host.name, command, name)
          }
        />

        <SshTerminal hostId={host.id} />
      </div>
    );
  }

  const service = services.find((s) => s.id === selected.id);
  if (!service) return null;
  const host = hosts.find((h) => h.id === service.hostId);
  return (
    <div className="flex flex-col gap-4">
      <Header title={service.name} onDelete={() => onDeleteService(service.id)} />
      <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
        <dt className="text-ink-faint">Type</dt>
        <dd className="text-right text-ink">{service.type}</dd>
        <dt className="text-ink-faint">Host</dt>
        <dd className="text-right text-ink">{host?.name ?? "—"}</dd>
      </dl>
    </div>
  );
}

function Header({ title, onDelete }: { title: string; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <button
        onClick={onDelete}
        className="text-ink-faint transition-colors hover:text-red-400"
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
