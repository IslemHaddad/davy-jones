import { useEffect, useState } from "react";
import { Header } from "./Layout/Header";
import { Sidebar } from "./Layout/Sidebar";
import { InfraGraph } from "./Graph/InfraGraph";
import { TerminalTray } from "./Terminal/TerminalTray";
import { useInfraData } from "../hooks/useInfraData";
import { useProjects } from "../hooks/useProjects";
import { usePingStatus } from "../hooks/usePingStatus";
import type { SelectedNode, TerminalTab } from "../types";

const ACTIVE_PROJECT_KEY = "dcc_active_project";

export function Dashboard() {
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

  const data = useInfraData(activeProjectId);
  const pingStatus = usePingStatus(data.hosts);
  const [selected, setSelected] = useState<SelectedNode | null>(null);

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

  return (
    <div className="flex h-screen w-screen flex-col bg-canvas">
      <Header
        projects={projects.projects}
        activeProjectId={activeProjectId}
        onChangeProject={setActiveProjectId}
        onCreateProject={projects.createProject}
        onUpdateProject={projects.updateProject}
        onDeleteProject={projects.deleteProject}
        onProjectsChanged={projects.reload}
      />
      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1">
          {data.loading ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">
              Loading infrastructure...
            </div>
          ) : (
            <InfraGraph
              vpns={data.vpns}
              hosts={data.hosts}
              services={data.services}
              pingStatus={pingStatus}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </main>
        <Sidebar
          selected={selected}
          vpns={data.vpns}
          hosts={data.hosts}
          services={data.services}
          credentials={data.credentials}
          savedCommands={data.savedCommands}
          onCreateVpn={data.createVpn}
          onCreateHost={data.createHost}
          onCreateService={data.createService}
          onCreateCredential={data.createCredential}
          onUpdateCredential={data.updateCredential}
          onDeleteCredential={data.deleteCredential}
          onCreateSavedCommand={data.createSavedCommand}
          onDeleteSavedCommand={data.deleteSavedCommand}
          onOpenShell={openShell}
          onRunCommand={runCommand}
          onDeleteVpn={(id) => {
            if (selected?.kind === "vpn" && selected.id === id) setSelected(null);
            data.deleteVpn(id);
          }}
          onDeleteHost={(id) => {
            if (selected?.kind === "host" && selected.id === id) setSelected(null);
            data.deleteHost(id);
          }}
          onDeleteService={(id) => {
            if (selected?.kind === "service" && selected.id === id)
              setSelected(null);
            data.deleteService(id);
          }}
        />
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
