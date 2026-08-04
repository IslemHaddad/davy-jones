import { useEffect, useMemo, useState } from "react";
import { Header } from "./Layout/Header";
import { Sidebar, type SidebarTab } from "./Layout/Sidebar";
import { InfraGraph } from "./Graph/InfraGraph";
import { ErrorBoundary } from "./ErrorBoundary";
import { TerminalTray } from "./Terminal/TerminalTray";
import { useInfraData } from "../hooks/useInfraData";
import { useProjects } from "../hooks/useProjects";
import { usePingStatus } from "../hooks/usePingStatus";
import { useHostMetrics } from "../hooks/useHostMetrics";
import { useGraphLayout } from "../hooks/useGraphLayout";
import { useServiceStatus } from "../hooks/useServiceStatus";
import { hostActions, serviceActions, vpnActions } from "../lib/nodeCommands";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import type {
  Host,
  Project,
  SelectedNode,
  Service,
  TerminalTab,
  Vpn,
} from "../types";

const ACTIVE_PROJECT_KEY = "dcc_active_project";

export function Dashboard() {
  const { canWrite } = useAuth();
  const projects = useProjects();
  const [activeProjectId, setActiveProjectId] = useState(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY) ?? "",
  );

  useEffect(() => {
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
  }, [activeProjectId]);

  // If the stored project was deleted elsewhere, fall back to Unassigned
  // rather than silently querying a project id that no longer exists.
  useEffect(() => {
    if (projects.loading || activeProjectId === "") return;
    if (!projects.projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectId("");
    }
  }, [projects.loading, projects.projects, activeProjectId]);

  // Creating a project is an act of intent to work in it -- switch the whole
  // dashboard over so the resources you add next land there, instead of
  // silently leaving you on the previously active project.
  async function createAndSwitchProject(
    project: Omit<Project, "id" | "createdAt">,
  ) {
    const created = await projects.createProject(project);
    setActiveProjectId(created.id);
  }

  async function handleProjectsChanged(newProjectId?: string) {
    await projects.reload();
    if (newProjectId) setActiveProjectId(newProjectId);
  }

  const data = useInfraData(activeProjectId);
  const pingStatus = usePingStatus(data.hosts);
  const metrics = useHostMetrics(data.hosts, pingStatus);
  const graphLayout = useGraphLayout(activeProjectId);
  const serviceStatus = useServiceStatus(data.services, pingStatus);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("details");

  // Double-click means "show me this thing", so select it *and* make sure
  // the panel showing details is the one on screen.
  function openDetails(node: SelectedNode) {
    setSelected(node);
    setSidebarTab("details");
  }

  // One delete path for both the sidebar's trash icon and the canvas's
  // right-click menu, so the selection is always cleared with the resource
  // it points at -- a stale selection would leave the details panel
  // describing something that no longer exists.
  function deleteResource(node: SelectedNode) {
    if (selected?.kind === node.kind && selected.id === node.id) {
      setSelected(null);
    }
    if (node.kind === "vpn") data.deleteVpn(node.id);
    else if (node.kind === "host") data.deleteHost(node.id);
    else data.deleteService(node.id);
  }

  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    null,
  );
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

  function openShell(hostId: string, hostName: string) {
    const id = crypto.randomUUID();
    setTerminalTabs((prev) => [
      ...prev,
      { id, hostId, hostName, label: hostName },
    ]);
    setActiveTerminalId(id);
    setTerminalCollapsed(false);
  }

  function runCommand(
    hostId: string,
    hostName: string,
    command: string,
    name: string,
  ) {
    const id = crypto.randomUUID();
    setTerminalTabs((prev) => [
      ...prev,
      { id, hostId, hostName, command, label: `${hostName} — ${name}` },
    ]);
    setActiveTerminalId(id);
    setTerminalCollapsed(false);
  }

  function closeTerminal(id: string) {
    const next = terminalTabs.filter((t) => t.id !== id);
    setTerminalTabs(next);
    if (activeTerminalId === id) {
      setActiveTerminalId(next.length > 0 ? next[next.length - 1].id : null);
    }
  }

  // Rebuilt only when the data behind the buttons changes -- an unstable
  // object here would re-run the whole graph layout on every render.
  const nodeActionBuilders = useMemo(() => {
    // Every button here runs a command, which the server refuses for a
    // read-only account -- so don't offer them at all.
    if (!canWrite) {
      return { vpn: () => [], host: () => [], service: () => [] };
    }
    const handlers = { onOpenShell: openShell, onRunCommand: runCommand };
    const hostById = new Map(data.hosts.map((h) => [h.id, h]));
    return {
      vpn: (vpn: Vpn) =>
        vpnActions(vpn, (id, action) => {
          const call =
            action === "start"
              ? api.vpnDiagnostics.dockerStart
              : api.vpnDiagnostics.dockerStop;
          // Fire-and-forget from the canvas: the sidebar's VPN panel is
          // where output and errors are meant to be read.
          call(id).catch(() => {});
        }),
      host: (host: Host) => hostActions(host, handlers),
      service: (service: Service) =>
        serviceActions(service, hostById.get(service.hostId), handlers),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.hosts, canWrite]);

  return (
    <div className="flex h-screen w-screen flex-col bg-canvas">
      <Header
        projects={projects.projects}
        activeProjectId={activeProjectId}
        onChangeProject={setActiveProjectId}
        onCreateProject={createAndSwitchProject}
        onUpdateProject={projects.updateProject}
        onDeleteProject={projects.deleteProject}
        onProjectsChanged={handleProjectsChanged}
      />
      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1">
          {data.loading ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">
              Loading infrastructure...
            </div>
          ) : data.error && !data.loadedOnce ? (
            // Nothing has ever loaded, so there is genuinely nothing to draw.
            // Without this the canvas just renders empty on a failed load,
            // which reads as "everything is gone" rather than "the data
            // didn't arrive".
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-lg border-t-2 border-red-500 bg-surface p-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-red-400">
                  Could not load this project
                </div>
                <p className="break-words text-xs text-ink-muted">
                  {data.error}
                </p>
                <button
                  onClick={() => data.reload()}
                  className="mt-3 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <>
            {/* A refresh failed but the graph below is still the last good
                picture. Say so in a strip over the canvas rather than
                replacing it -- losing the whole diagram over one blip is
                worse than looking at data a minute out of date. */}
            {data.error && (
              <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                  Showing last known state
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
                  {data.error}
                </span>
                <button
                  onClick={() => data.reload()}
                  className="shrink-0 rounded border border-border-strong px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
                >
                  Retry
                </button>
              </div>
            )}
            <ErrorBoundary area="Infrastructure graph">
            <InfraGraph
              vpns={data.vpns}
              hosts={data.hosts}
              services={data.services}
              pingStatus={pingStatus}
              metrics={metrics}
              serviceStatus={serviceStatus}
              actions={nodeActionBuilders}
              selected={selected}
              onSelect={setSelected}
              onOpenDetails={openDetails}
              savedPositions={graphLayout.positions}
              layoutLoaded={graphLayout.loaded}
              onPositionsChange={graphLayout.savePositions}
              openTerminalCount={terminalTabs.length}
              onCloseAllTerminals={() => {
                setTerminalTabs([]);
                setActiveTerminalId(null);
              }}
              canDelete={canWrite}
              onDeleteNode={deleteResource}
            />
            </ErrorBoundary>
            </>
          )}
        </main>
        <ErrorBoundary area="Sidebar">
        <Sidebar
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          selected={selected}
          metrics={metrics}
          vpns={data.vpns}
          hosts={data.hosts}
          services={data.services}
          credentials={data.credentials}
          projects={projects.projects}
          activeProjectId={activeProjectId}
          savedCommands={data.savedCommands}
          onCreateVpn={data.createVpn}
          onCreateHost={data.createHost}
          onCreateService={data.createService}
          onCreateCredential={data.createCredential}
          onUpdateVpn={data.updateVpn}
          onUpdateHost={data.updateHost}
          onUpdateService={data.updateService}
          onUpdateCredential={data.updateCredential}
          onDeleteCredential={data.deleteCredential}
          onCreateSavedCommand={data.createSavedCommand}
          onDeleteSavedCommand={data.deleteSavedCommand}
          onOpenShell={openShell}
          onRunCommand={runCommand}
          onDeleteVpn={(id) => deleteResource({ kind: "vpn", id })}
          onDeleteHost={(id) => deleteResource({ kind: "host", id })}
          onDeleteService={(id) => deleteResource({ kind: "service", id })}
        />
        </ErrorBoundary>
      </div>
      <TerminalTray
        tabs={terminalTabs}
        activeId={activeTerminalId}
        collapsed={terminalCollapsed}
        onSelect={setActiveTerminalId}
        onClose={closeTerminal}
        onToggleCollapsed={() => setTerminalCollapsed((v) => !v)}
      />
    </div>
  );
}
