import { useEffect, useRef, useState } from "react";
import {
  Anchor,
  ChevronDown,
  FolderKanban,
  KeyRound,
  LogOut,
  ScrollText,
  Settings,
  Moon,
  Sun,
  Users as UsersIcon,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { AdminPanel, type AdminTab } from "../Admin/AdminPanel";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import type { Project } from "../../types";

const ADMIN_MENU: { tab: AdminTab; label: string; icon: typeof UsersIcon }[] = [
  { tab: "users", label: "Add Users", icon: UsersIcon },
  { tab: "projects", label: "Add Projects", icon: FolderKanban },
  { tab: "audit", label: "Logs", icon: ScrollText },
];

interface HeaderProps {
  projects: Project[];
  activeProjectId: string;
  onChangeProject: (id: string) => void;
  onCreateProject: (
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onUpdateProject: (
    id: string,
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onDeleteProject: (id: string) => void;
  onProjectsChanged: (newProjectId?: string) => Promise<void>;
}

export function Header(props: HeaderProps) {
  const { logout, currentUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  // `null` = panel closed; otherwise the tab it should open on.
  const [adminTab, setAdminTab] = useState<AdminTab | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Anchor size={14} className="text-ink-muted" />
          <span className="text-xs font-semibold tracking-wide text-ink">
            Davy Jones
          </span>
        </div>
        <select
          value={props.activeProjectId}
          onChange={(e) => props.onChangeProject(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-border-strong"
          title="Active project"
        >
          <option value="">Unassigned</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-4">
        {currentUser && (
          <span className="text-[10px] uppercase tracking-widest text-ink-faint">
            {currentUser.username}
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="text-ink-faint transition-colors hover:text-ink"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
          >
            <Settings size={12} />
            Admin
            <ChevronDown size={12} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded border border-border bg-card shadow-lg"
            >
              {/* Above the admin entries, and separated from them: this is
                  the one item here that every account can use, whatever
                  its role. */}
              <button
                role="menuitem"
                onClick={() => {
                  setChangingPassword(true);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[11px] text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <KeyRound size={12} className="text-ink-faint" />
                Change Password
              </button>
              {ADMIN_MENU.map(({ tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  role="menuitem"
                  onClick={() => {
                    setAdminTab(tab);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  <Icon size={12} className="text-ink-faint" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => logout()}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
        >
          <LogOut size={12} />
          Lock
        </button>
      </div>
      {changingPassword && (
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      )}
      {adminTab && (
        <AdminPanel
          initialTab={adminTab}
          onClose={() => setAdminTab(null)}
          projects={props.projects}
          onCreateProject={props.onCreateProject}
          onUpdateProject={props.onUpdateProject}
          onDeleteProject={props.onDeleteProject}
          onProjectsChanged={props.onProjectsChanged}
        />
      )}
    </header>
  );
}
