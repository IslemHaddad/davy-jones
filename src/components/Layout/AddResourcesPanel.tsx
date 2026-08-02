import { useState, type ReactNode } from "react";
import { Network, Server, Box, Key, Pencil, Trash2 } from "lucide-react";
import type {
  ClientCertificate,
  Credential,
  Host,
  Service,
  Vpn,
} from "../../types";

type ResourceKind = "vpn" | "host" | "service" | "credential";

interface AddResourcesPanelProps {
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
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
}

const TABS: { key: ResourceKind; label: string; icon: typeof Network }[] = [
  { key: "vpn", label: "VPN", icon: Network },
  { key: "host", label: "Host", icon: Server },
  { key: "service", label: "Service", icon: Box },
  { key: "credential", label: "Credential", icon: Key },
];

export function AddResourcesPanel(props: AddResourcesPanelProps) {
  const [tab, setTab] = useState<ResourceKind>("vpn");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition-colors ${
              tab === key
                ? "border-border-strong bg-card text-ink"
                : "border-border bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {tab === "vpn" && (
        <VpnForm
          vpns={props.vpns}
          credentials={props.credentials}
          onCreate={props.onCreateVpn}
          onUpdate={props.onUpdateVpn}
          onDelete={props.onDeleteVpn}
        />
      )}
      {tab === "host" && (
        <HostForm
          hosts={props.hosts}
          credentials={props.credentials}
          vpns={props.vpns}
          onCreate={props.onCreateHost}
          onUpdate={props.onUpdateHost}
          onDelete={props.onDeleteHost}
        />
      )}
      {tab === "service" && (
        <ServiceForm
          services={props.services}
          hosts={props.hosts}
          onCreate={props.onCreateService}
          onUpdate={props.onUpdateService}
          onDelete={props.onDeleteService}
        />
      )}
      {tab === "credential" && (
        <CredentialForm
          credentials={props.credentials}
          onCreate={props.onCreateCredential}
          onUpdate={props.onUpdateCredential}
          onDelete={props.onDeleteCredential}
        />
      )}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-border-strong";
export const monoInputClass = `${inputClass} font-mono`;

export function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="mt-1 rounded bg-ink px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-canvas"
    >
      {label}
    </button>
  );
}

const DEFAULT_VPN_COMMAND =
  "docker run -d --name {{container}} --net=host --privileged " +
  "-e VPN_HOST={{host}} -e VPN_PORT={{port}} -e VPN_USER={{user}} " +
  "-e VPN_PASS={{pass}} {{image}}";

const VPN_PRESETS: Record<
  string,
  { label: string; image: string; command: string; port: number }
> = {
  fortivpn: {
    label: "FortiClient VPN (openfortivpn)",
    image: "davy-jones-forticlient-vpn:latest",
    command:
      "docker run -d -i --name {{container}} --net=host --privileged " +
      "--device=/dev/net/tun -e VPN_HOST={{host}} -e VPN_PORT={{port}} " +
      "-e VPN_USER={{user}} -e VPN_PASS={{pass}} {{image}}",
    port: 443,
  },
};

const emptyVpnForm = {
  name: "",
  image: "",
  containerName: "",
  command: DEFAULT_VPN_COMMAND,
  remoteGateway: "",
  port: 10443,
  clientCertificate: "none" as ClientCertificate,
  credentialId: "",
};

function VpnForm({
  vpns,
  credentials,
  onCreate,
  onUpdate,
  onDelete,
}: {
  vpns: Vpn[];
  credentials: Credential[];
  onCreate: (vpn: Omit<Vpn, "id">) => Promise<void>;
  onUpdate: (id: string, vpn: Omit<Vpn, "id">) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState(emptyVpnForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState("");

  function applyPreset(key: string) {
    setPresetKey(key);
    const preset = VPN_PRESETS[key];
    if (!preset) return;
    setForm({
      ...form,
      image: preset.image,
      command: preset.command,
      port: preset.port,
    });
  }

  function startEdit(vpn: Vpn) {
    setEditingId(vpn.id);
    setPresetKey("");
    setForm({
      name: vpn.name,
      image: vpn.image,
      containerName: vpn.containerName,
      command: vpn.command,
      remoteGateway: vpn.remoteGateway,
      port: vpn.port,
      clientCertificate: vpn.clientCertificate,
      credentialId: vpn.credentialId ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setPresetKey("");
    setForm(emptyVpnForm);
  }

  return (
    <div className="flex flex-col gap-4">
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const payload = {
          ...form,
          credentialId: form.credentialId || undefined,
        };
        if (editingId) {
          await onUpdate(editingId, payload);
        } else {
          await onCreate(payload);
        }
        setEditingId(null);
        setPresetKey("");
        setForm(emptyVpnForm);
      }}
    >
      <Field label="Name">
        <input
          required
          className={inputClass}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Preset">
        <select
          className={inputClass}
          value={presetKey}
          onChange={(e) => applyPreset(e.target.value)}
        >
          <option value="">Custom</option>
          {Object.entries(VPN_PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.label}
            </option>
          ))}
        </select>
        <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
          Fills in Image, Container Command, and Port below -- still
          editable after.
        </span>
      </Field>
      <Field label="Docker Image">
        <input
          required
          placeholder="openforti-runner"
          className={monoInputClass}
          value={form.image}
          onChange={(e) => setForm({ ...form, image: e.target.value })}
        />
      </Field>
      <Field label="Container Name">
        <input
          required
          placeholder="dj-vpn-oran"
          className={monoInputClass}
          value={form.containerName}
          onChange={(e) =>
            setForm({ ...form, containerName: e.target.value })
          }
        />
        <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
          Start/Stop/Status/Logs/Ping/Nc all target this exact container
          name.
        </span>
      </Field>
      <Field label="Container Command">
        <textarea
          required
          rows={3}
          spellCheck={false}
          className={`${monoInputClass} resize-y leading-relaxed`}
          value={form.command}
          onChange={(e) => setForm({ ...form, command: e.target.value })}
        />
        <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
          Run once when this VPN is saved (created or edited) to (re)build
          its container, with {"{{host}}"} {"{{port}}"} {"{{user}}"}{" "}
          {"{{pass}}"} {"{{image}}"} {"{{container}}"} substituted (the last
          from Container Name above). Start/Stop afterward just toggle that
          same container -- they don't run this again. Keep{" "}
          <code>--name {"{{container}}"}</code> in the command, and always
          include <code>-d</code> (detached) -- saving waits for this
          command to return, so without it the request just hangs until it
          times out.
        </span>
      </Field>
      <Field label="Remote Gateway">
        <input
          required
          placeholder="vpn.example.com"
          className={monoInputClass}
          value={form.remoteGateway}
          onChange={(e) => setForm({ ...form, remoteGateway: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Port">
          <input
            type="number"
            className={monoInputClass}
            value={form.port}
            onChange={(e) =>
              setForm({ ...form, port: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Certificate">
          <select
            className={inputClass}
            value={form.clientCertificate}
            onChange={(e) =>
              setForm({
                ...form,
                clientCertificate: e.target.value as ClientCertificate,
              })
            }
          >
            <option value="none">none</option>
            <option value="local">local</option>
            <option value="smartcard">smartcard</option>
          </select>
        </Field>
      </div>
      <Field label="Credential (optional)">
        <select
          className={inputClass}
          value={form.credentialId}
          onChange={(e) => setForm({ ...form, credentialId: e.target.value })}
        >
          <option value="">None</option>
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <SubmitButton label={editingId ? "Update VPN" : "Add VPN"} />
        {editingId && (
          <button
            type="button"
            onClick={cancelEdit}
            className="mt-1 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </form>

      {vpns.length > 0 && (
        <div>
          <div className="section-header mb-2">Existing VPNs</div>
          <div className="flex flex-col gap-1.5">
            {vpns.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-ink">{v.name}</div>
                  <div className="truncate font-mono text-[11px] text-ink-faint">
                    {v.remoteGateway}
                  </div>
                </div>
                <button
                  onClick={() => startEdit(v)}
                  className="text-ink-faint hover:text-ink"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => onDelete(v.id)}
                  className="text-ink-faint hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyHostForm = {
  name: "",
  ip: "",
  credentialId: "",
  vpnId: "",
  port: "",
};

function HostForm({
  hosts,
  credentials,
  vpns,
  onCreate,
  onUpdate,
  onDelete,
}: {
  hosts: Host[];
  credentials: Credential[];
  vpns: Vpn[];
  onCreate: (host: Omit<Host, "id">) => Promise<void>;
  onUpdate: (id: string, host: Omit<Host, "id">) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState(emptyHostForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(host: Host) {
    setEditingId(host.id);
    setForm({
      name: host.name,
      ip: host.ip,
      credentialId: host.credentialId,
      vpnId: host.vpnId ?? "",
      port: host.port ? String(host.port) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyHostForm);
  }

  return (
    <div className="flex flex-col gap-4">
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const payload = {
          name: form.name,
          ip: form.ip,
          credentialId: form.credentialId,
          vpnId: form.vpnId || undefined,
          port: form.port ? Number(form.port) : undefined,
        };
        if (editingId) {
          await onUpdate(editingId, payload);
        } else {
          await onCreate(payload);
        }
        setEditingId(null);
        setForm(emptyHostForm);
      }}
    >
      <Field label="Name">
        <input
          required
          className={inputClass}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="IP Address">
          <input
            required
            placeholder="10.0.0.5"
            className={monoInputClass}
            value={form.ip}
            onChange={(e) => setForm({ ...form, ip: e.target.value })}
          />
        </Field>
        <Field label="SSH Port">
          <input
            type="number"
            placeholder="22"
            className={monoInputClass}
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Credential">
        <select
          required
          className={inputClass}
          value={form.credentialId}
          onChange={(e) => setForm({ ...form, credentialId: e.target.value })}
        >
          <option value="" disabled>
            Select credential
          </option>
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="VPN (optional)">
        <select
          className={inputClass}
          value={form.vpnId}
          onChange={(e) => setForm({ ...form, vpnId: e.target.value })}
        >
          <option value="">None</option>
          {vpns.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <SubmitButton label={editingId ? "Update Host" : "Add Host"} />
        {editingId && (
          <button
            type="button"
            onClick={cancelEdit}
            className="mt-1 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </form>

      {hosts.length > 0 && (
        <div>
          <div className="section-header mb-2">Existing Hosts</div>
          <div className="flex flex-col gap-1.5">
            {hosts.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-ink">{h.name}</div>
                  <div className="truncate font-mono text-[11px] text-ink-faint">
                    {h.ip}
                  </div>
                </div>
                <button
                  onClick={() => startEdit(h)}
                  className="text-ink-faint hover:text-ink"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => onDelete(h.id)}
                  className="text-ink-faint hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceForm({
  services,
  hosts,
  onCreate,
  onUpdate,
  onDelete,
}: {
  services: Service[];
  hosts: Host[];
  onCreate: (service: Omit<Service, "id">) => Promise<void>;
  onUpdate: (id: string, service: Omit<Service, "id">) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const emptyForm = { name: "", type: "Docker", hostId: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(service: Service) {
    setEditingId(service.id);
    setForm({ name: service.name, type: service.type, hostId: service.hostId });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  return (
    <div className="flex flex-col gap-4">
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (editingId) {
          await onUpdate(editingId, form);
        } else {
          await onCreate(form);
        }
        setEditingId(null);
        setForm(emptyForm);
      }}
    >
      <Field label="Name">
        <input
          required
          className={inputClass}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Type">
        <select
          className={inputClass}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="Docker">Docker</option>
          <option value="Node">Node</option>
          <option value="Nginx">Nginx</option>
        </select>
      </Field>
      <Field label="Host">
        <select
          required
          className={inputClass}
          value={form.hostId}
          onChange={(e) => setForm({ ...form, hostId: e.target.value })}
        >
          <option value="" disabled>
            Select host
          </option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <SubmitButton label={editingId ? "Update Service" : "Add Service"} />
        {editingId && (
          <button
            type="button"
            onClick={cancelEdit}
            className="mt-1 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </form>

      {services.length > 0 && (
        <div>
          <div className="section-header mb-2">Existing Services</div>
          <div className="flex flex-col gap-1.5">
            {services.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-ink">{s.name}</div>
                  <div className="truncate font-mono text-[11px] text-ink-faint">
                    {s.type} · {hosts.find((h) => h.id === s.hostId)?.name ?? "—"}
                  </div>
                </div>
                <button
                  onClick={() => startEdit(s)}
                  className="text-ink-faint hover:text-ink"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => onDelete(s.id)}
                  className="text-ink-faint hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyCredentialForm = {
  name: "",
  username: "",
  password: "",
  privateKey: "",
  passphrase: "",
};

function CredentialForm({
  credentials,
  onCreate,
  onUpdate,
  onDelete,
}: {
  credentials: Credential[];
  onCreate: (credential: Omit<Credential, "id">) => Promise<void>;
  onUpdate: (id: string, credential: Omit<Credential, "id">) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState(emptyCredentialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missingAuth = !form.password.trim() && !form.privateKey.trim();

  function startEdit(cred: Credential) {
    setEditingId(cred.id);
    setForm({
      name: cred.name,
      username: cred.username,
      password: cred.password ?? "",
      privateKey: cred.privateKey ?? "",
      passphrase: cred.passphrase ?? "",
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyCredentialForm);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (missingAuth) {
      setError("Enter a password or a private key -- at least one is required to run SSH commands.");
      return;
    }
    setError(null);
    const payload = {
      name: form.name,
      username: form.username,
      password: form.password || undefined,
      privateKey: form.privateKey || undefined,
      passphrase: form.passphrase || undefined,
    };
    if (editingId) {
      await onUpdate(editingId, payload);
    } else {
      await onCreate(payload);
    }
    setEditingId(null);
    setForm(emptyCredentialForm);
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Field label="Name">
          <input
            required
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Username">
          <input
            required
            className={monoInputClass}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </Field>
        <Field label="Password (required unless using a private key)">
          <input
            type="password"
            className={inputClass}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Private Key (required unless using a password)">
          <textarea
            rows={4}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            className={`${monoInputClass} resize-none`}
            value={form.privateKey}
            onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
          />
        </Field>
        <Field label="Passphrase (only if the private key is encrypted)">
          <input
            type="password"
            className={inputClass}
            value={form.passphrase}
            onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
          />
        </Field>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <SubmitButton label={editingId ? "Update Credential" : "Add Credential"} />
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="mt-1 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {credentials.length > 0 && (
        <div>
          <div className="section-header mb-2">Existing Credentials</div>
          <div className="flex flex-col gap-1.5">
            {credentials.map((c) => {
              const broken = !c.password && !c.privateKey;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 rounded border bg-surface px-2.5 py-1.5 ${
                    broken ? "border-red-500/40" : "border-border"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-ink">{c.name}</div>
                    <div className="truncate font-mono text-[11px] text-ink-faint">
                      {c.username}
                      {broken && (
                        <span className="ml-2 text-red-400">
                          no password/key set
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => startEdit(c)}
                    className="text-ink-faint hover:text-ink"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    className="text-ink-faint hover:text-red-400"
                    title="Delete"
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
