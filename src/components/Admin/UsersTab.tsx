import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { ROLE_LABELS, type Role, type User } from "../../types";

const ROLES = Object.keys(ROLE_LABELS) as Role[];
import {
  Field,
  SubmitButton,
  inputClass,
} from "../Layout/AddResourcesPanel";

export function UsersTab() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("readwrite");
  const [error, setError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === "admin";

  async function reload() {
    setUsers(await api.users.list());
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.users.create(username, password, role);
      setUsername("");
      setPassword("");
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRoleChange(id: string, next: Role) {
    setError(null);
    try {
      await api.users.setRole(id, next);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await api.users.remove(id);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Field label="Username">
          <input
            required
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            required
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Role">
          <select
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!isAdmin && (
          <p className="text-[11px] text-ink-faint">
            Only administrators can add users or change roles.
          </p>
        )}
        <SubmitButton label="Add User" />
      </form>

      {!loading && (
        <div>
          <div className="section-header mb-2">Existing Users</div>
          <div className="flex flex-col gap-1.5">
            {users.map((u) => {
              const isLastUser = users.length <= 1;
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-ink">
                      {u.username}
                      {u.id === currentUser?.id && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-ink-faint">
                          you
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-ink-faint">
                      created {new Date(u.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <select
                    value={u.role}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      handleRoleChange(u.id, e.target.value as Role)
                    }
                    title={
                      isAdmin
                        ? "Change role (signs this user out immediately)"
                        : "Only administrators can change roles"
                    }
                    className="rounded border border-border bg-card px-1.5 py-1 text-[10px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleDelete(u.id)}
                    disabled={isLastUser || !isAdmin}
                    className="text-ink-faint hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                    title={
                      isLastUser
                        ? "Cannot delete the last remaining user"
                        : !isAdmin
                          ? "Only administrators can delete users"
                          : "Delete"
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
