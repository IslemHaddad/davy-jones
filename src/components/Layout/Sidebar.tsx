import { SlidersHorizontal, PlusCircle } from "lucide-react";
import type {
  CommandResult,
  Credential,
  Host,
  HostMetricsResponse,
  IpsecCredential,
  Project,
  SavedCommand,
  Service,
  Vpn,
  SelectedNode,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { DetailsPanel } from "./DetailsPanel";
import { AddResourcesPanel } from "./AddResourcesPanel";

export type SidebarTab = "details" | "add";

interface SidebarProps {
  // Controlled by Dashboard so double-clicking a node on the canvas can
  // force the details tab open.
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  selected: SelectedNode | null;
  metrics: Record<string, HostMetricsResponse>;
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
  ipsecCredentials: IpsecCredential[];
  projects: Project[];
  activeProjectId: string;
  savedCommands: SavedCommand[];
  onCreateVpn: (
    vpn: Omit<Vpn, "id">,
  ) => Promise<(Vpn & { container: CommandResult }) | void>;
  onCreateHost: (host: Omit<Host, "id">) => Promise<void>;
  onCreateService: (service: Omit<Service, "id">) => Promise<void>;
  onCreateCredential: (credential: Omit<Credential, "id">) => Promise<void>;
  onCreateIpsecCredential: (
    credential: Omit<IpsecCredential, "id">,
  ) => Promise<void>;
  onUpdateVpn: (
    id: string,
    vpn: Omit<Vpn, "id">,
  ) => Promise<(Vpn & { container: CommandResult }) | void>;
  onUpdateHost: (id: string, host: Omit<Host, "id">) => Promise<void>;
  onUpdateService: (id: string, service: Omit<Service, "id">) => Promise<void>;
  onUpdateCredential: (
    id: string,
    credential: Omit<Credential, "id">,
  ) => Promise<void>;
  onUpdateIpsecCredential: (
    id: string,
    credential: Partial<Omit<IpsecCredential, "id">>,
  ) => Promise<void>;
  onDeleteVpn: (id: string) => void;
  onDeleteHost: (id: string) => void;
  onDeleteService: (id: string) => void;
  onDeleteCredential: (id: string) => void;
  onDeleteIpsecCredential: (id: string) => void;
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
  const { tab, onTabChange: setTab } = props;
  const { canWrite } = useAuth();
  // A read-only account can't create anything, so the tab is hidden rather
  // than left to fail on submit. Falling back to details also keeps the
  // panel valid if the role changes while "add" is open.
  const activeTab = canWrite ? tab : "details";

  return (
    <aside className="flex h-full w-96 flex-col border-l border-border bg-surface">
      <div className="flex border-b border-border">
        <TabButton
          active={activeTab === "details"}
          onClick={() => setTab("details")}
          icon={<SlidersHorizontal size={12} />}
          label="Details & Actions"
        />
        {canWrite && (
          <TabButton
            active={activeTab === "add"}
            onClick={() => setTab("add")}
            icon={<PlusCircle size={12} />}
            label="Add Resources"
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "details" ? (
          <DetailsPanel
            selected={props.selected}
            vpns={props.vpns}
            hosts={props.hosts}
            services={props.services}
            credentials={props.credentials}
            savedCommands={props.savedCommands}
            metrics={props.metrics}
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
            ipsecCredentials={props.ipsecCredentials}
            projects={props.projects}
            activeProjectId={props.activeProjectId}
            onCreateVpn={props.onCreateVpn}
            onCreateHost={props.onCreateHost}
            onCreateService={props.onCreateService}
            onCreateCredential={props.onCreateCredential}
            onCreateIpsecCredential={props.onCreateIpsecCredential}
            onUpdateVpn={props.onUpdateVpn}
            onUpdateHost={props.onUpdateHost}
            onUpdateService={props.onUpdateService}
            onUpdateCredential={props.onUpdateCredential}
            onUpdateIpsecCredential={props.onUpdateIpsecCredential}
            onDeleteVpn={props.onDeleteVpn}
            onDeleteHost={props.onDeleteHost}
            onDeleteService={props.onDeleteService}
            onDeleteCredential={props.onDeleteCredential}
            onDeleteIpsecCredential={props.onDeleteIpsecCredential}
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
