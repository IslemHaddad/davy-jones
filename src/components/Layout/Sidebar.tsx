import { useState } from "react";
import { SlidersHorizontal, PlusCircle } from "lucide-react";
import type {
  Credential,
  Host,
  SavedCommand,
  Service,
  Vpn,
  SelectedNode,
} from "../../types";
import { DetailsPanel } from "./DetailsPanel";
import { AddResourcesPanel } from "./AddResourcesPanel";

type Tab = "details" | "add";

interface SidebarProps {
  selected: SelectedNode | null;
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
  savedCommands: SavedCommand[];
  onCreateVpn: (vpn: Omit<Vpn, "id">) => Promise<void>;
  onCreateHost: (host: Omit<Host, "id">) => Promise<void>;
  onCreateService: (service: Omit<Service, "id">) => Promise<void>;
  onCreateCredential: (credential: Omit<Credential, "id">) => Promise<void>;
  onUpdateVpn: (id: string, vpn: Omit<Vpn, "id">) => Promise<void>;
  onUpdateHost: (id: string, host: Omit<Host, "id">) => Promise<void>;
  onUpdateService: (id: string, service: Omit<Service, "id">) => Promise<void>;
  onUpdateCredential: (
    id: string,
    credential: Omit<Credential, "id">,
  ) => Promise<void>;
  onDeleteVpn: (id: string) => void;
  onDeleteHost: (id: string) => void;
  onDeleteService: (id: string) => void;
  onDeleteCredential: (id: string) => void;
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

export function Sidebar(props: SidebarProps) {
  const [tab, setTab] = useState<Tab>("details");

  return (
    <aside className="flex h-full w-96 flex-col border-l border-border bg-surface">
      <div className="flex border-b border-border">
        <TabButton
          active={tab === "details"}
          onClick={() => setTab("details")}
          icon={<SlidersHorizontal size={12} />}
          label="Details & Actions"
        />
        <TabButton
          active={tab === "add"}
          onClick={() => setTab("add")}
          icon={<PlusCircle size={12} />}
          label="Add Resources"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "details" ? (
          <DetailsPanel
            selected={props.selected}
            vpns={props.vpns}
            hosts={props.hosts}
            services={props.services}
            credentials={props.credentials}
            savedCommands={props.savedCommands}
            onDeleteVpn={props.onDeleteVpn}
            onDeleteHost={props.onDeleteHost}
            onDeleteService={props.onDeleteService}
            onCreateSavedCommand={props.onCreateSavedCommand}
            onDeleteSavedCommand={props.onDeleteSavedCommand}
            onOpenShell={props.onOpenShell}
            onRunCommand={props.onRunCommand}
          />
        ) : (
          <AddResourcesPanel
            vpns={props.vpns}
            hosts={props.hosts}
            services={props.services}
            credentials={props.credentials}
            onCreateVpn={props.onCreateVpn}
            onCreateHost={props.onCreateHost}
            onCreateService={props.onCreateService}
            onCreateCredential={props.onCreateCredential}
            onUpdateVpn={props.onUpdateVpn}
            onUpdateHost={props.onUpdateHost}
            onUpdateService={props.onUpdateService}
            onUpdateCredential={props.onUpdateCredential}
            onDeleteVpn={props.onDeleteVpn}
            onDeleteHost={props.onDeleteHost}
            onDeleteService={props.onDeleteService}
            onDeleteCredential={props.onDeleteCredential}
          />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
        active
          ? "border-ink text-ink"
          : "border-transparent text-ink-faint hover:text-ink-muted"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
