import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import type { User } from "../../types";
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
  const [error, setError] = useState<string | null>(null);

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
      await api.users.create(username, password);
      setUsername("");
      setPassword("");
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
        {error && <p className="text-xs text-red-400">{error}</p>}
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
                  <button
                    onClick={() => handleDelete(u.id)}
                    disabled={isLastUser}
                    className="text-ink-faint hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                    title={
                      isLastUser
                        ? "Cannot delete the last remaining user"
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
