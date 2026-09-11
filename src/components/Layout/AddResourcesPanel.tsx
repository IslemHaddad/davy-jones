import { useState, type ReactNode } from "react";
import {
  Network,
  Server,
  Box,
  Key,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import type {
  ClientCertificate,
  CommandResult,
  Credential,
  Host,
  IpsecCredential,
  Project,
  Service,
  Vpn,
} from "../../types";
import { api } from "../../lib/api";
import { DiscoverServices } from "./DiscoverServices";
import { IpsecCredentialForm } from "./IpsecCredentialForm";

type ResourceKind = "vpn" | "host" | "service" | "credential" | "ipsec";

/** What a create/update returns: the saved VPN plus the result of the
 * container build it triggered. The id matters to callers that have follow-up
 * work to do on a VPN that didn't exist until the call returned. */
type VpnSaveResult = (Vpn & { container: CommandResult }) | void;

interface AddResourcesPanelProps {
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
  ipsecCredentials: IpsecCredential[];
  projects: Project[];
  activeProjectId: string;
  onCreateVpn: (vpn: Omit<Vpn, "id">) => Promise<VpnSaveResult>;
  onCreateHost: (host: Omit<Host, "id">) => Promise<void>;
  onCreateService: (service: Omit<Service, "id">) => Promise<void>;
  onCreateCredential: (credential: Omit<Credential, "id">) => Promise<void>;
  onCreateIpsecCredential: (
    credential: Omit<IpsecCredential, "id">,
  ) => Promise<void>;
  onUpdateVpn: (id: string, vpn: Omit<Vpn, "id">) => Promise<VpnSaveResult>;
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
}

const TABS: { key: ResourceKind; label: string; icon: typeof Network }[] = [
  { key: "vpn", label: "VPN", icon: Network },
  { key: "host", label: "Host", icon: Server },
  { key: "service", label: "Service", icon: Box },
  { key: "credential", label: "Credential", icon: Key },
  { key: "ipsec", label: "IPsec", icon: Lock },
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
          ipsecCredentials={props.ipsecCredentials}
          projects={props.projects}
          activeProjectId={props.activeProjectId}
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
      {tab === "ipsec" && (
        <IpsecCredentialForm
          ipsecCredentials={props.ipsecCredentials}
          onCreate={props.onCreateIpsecCredential}
          onUpdate={props.onUpdateIpsecCredential}
          onDelete={props.onDeleteIpsecCredential}
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
  // Every VPN_* the ipsec-vpn image reads is passed, including the ones the
  // bound profile may leave empty. That's safe by construction: the image
  // resolves each with `${VAR:-default}`, which treats empty exactly like
  // unset -- so one command covers all four IKE modes rather than needing a
  // preset per mode. Certificates go over as base64 (the image accepts a
  // path, raw PEM, or base64) because raw multi-line PEM through a shell
  // command into `docker run -e` is only intact by luck of quoting.
  ipsec: {
    label: "IPsec / IKEv2 (strongSwan)",
    image: "davy-jones-ipsec-vpn:latest",
    command:
      "docker run -d --name {{container}} --net=host --privileged " +
      "--device=/dev/net/tun " +
      "-e VPN_HOST={{host}} -e VPN_PORT={{port}} " +
      "-e VPN_IKE_MODE={{ipsecIkeMode}} " +
      "-e VPN_USER={{ipsecUser}} -e VPN_PASS={{ipsecPass}} " +
      "-e VPN_PSK={{ipsecPsk}} " +
      "-e VPN_LOCAL_ID={{ipsecLocalId}} -e VPN_REMOTE_ID={{ipsecRemoteId}} " +
      "-e VPN_GATEWAY_CERT={{ipsecGatewayCertB64}} " +
      "-e VPN_CLIENT_CERT={{ipsecCertB64}} -e VPN_CLIENT_KEY={{ipsecKeyB64}} " +
      "-e VPN_IKE_PROPOSALS={{ipsecIkeProposal}} " +
      "-e VPN_ESP_PROPOSALS={{ipsecEspProposal}} " +
      "-e VPN_REMOTE_TS={{ipsecRemoteTs}} -e VPN_LOCAL_TS={{ipsecLocalTs}} " +
      "-e VPN_USERLAND={{ipsecUserland}} " +
      "{{image}}",
    // IKE is UDP/500 (and 4500 once NAT-T kicks in), not the 10443/443 an
    // SSL VPN listens on.
    port: 500,
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
  // undefined = "the active project" (filled in by useInfraData on create);
  // on an existing VPN this holds the owning project so editing it from a
  // project it's merely shared into doesn't reassign ownership.
  projectId: undefined as string | undefined,
  sharedProjectIds: [] as string[],
};

function VpnForm({
  vpns,
  credentials,
  ipsecCredentials,
  projects,
  activeProjectId,
  onCreate,
  onUpdate,
  onDelete,
}: {
  vpns: Vpn[];
  credentials: Credential[];
  ipsecCredentials: IpsecCredential[];
  projects: Project[];
  activeProjectId: string;
  onCreate: (vpn: Omit<Vpn, "id">) => Promise<VpnSaveResult>;
  onUpdate: (id: string, vpn: Omit<Vpn, "id">) => Promise<VpnSaveResult>;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState(emptyVpnForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState("");
  const [containerResult, setContainerResult] =
    useState<CommandResult | null>(null);
  // Not part of `form`: the binding lives behind its own endpoint rather
  // than on the VPN record, so it's loaded and saved separately.
  const [ipsecCredentialId, setIpsecCredentialId] = useState("");

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
      projectId: vpn.projectId,
      sharedProjectIds: vpn.sharedProjectIds ?? [],
    });
    // Clear first so a slow (or failed) fetch can't leave the previously
    // edited VPN's profile showing against this one -- and then be saved
    // onto it.
    setIpsecCredentialId("");
    api.ipsecCredentials
      .binding(vpn.id)
      .then((b) => setIpsecCredentialId(b.credentialId ?? ""))
      .catch(() => setIpsecCredentialId(""));
  }

  function toggleShare(projectId: string) {
    setForm((f) => ({
      ...f,
      sharedProjectIds: f.sharedProjectIds.includes(projectId)
        ? f.sharedProjectIds.filter((id) => id !== projectId)
        : [...f.sharedProjectIds, projectId],
    }));
  }

  function cancelEdit() {
    setEditingId(null);
    setPresetKey("");
    setForm(emptyVpnForm);
    setIpsecCredentialId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContainerResult(null);
    const payload = {
      ...form,
      credentialId: form.credentialId || undefined,
    };
    const usesIpsec = payload.command.includes("{{ipsec");

    let result: VpnSaveResult;
    if (editingId) {
      // Bind before saving. Saving rebuilds the container, and the rebuild
      // reads the binding -- doing these the other way round would provision
      // the container from the *previous* profile and only pick up the new
      // one on some later save.
      await api.ipsecCredentials.bind(editingId, ipsecCredentialId);
      result = await onUpdate(editingId, payload);
    } else {
      result = await onCreate(payload);
      // A new VPN has no id to bind against until it exists, so its first
      // container build necessarily ran unbound. Rebuild once with the
      // binding in place -- but only when the command actually reads the
      // profile, otherwise this would be a pointless second `docker run` on
      // every create.
      if (result && ipsecCredentialId) {
        await api.ipsecCredentials.bind(result.id, ipsecCredentialId);
        if (usesIpsec) result = await onUpdate(result.id, payload);
      }
    }

    if (result && (result.container.exitCode !== 0 || result.container.error)) {
      setContainerResult(result.container);
    }
    setEditingId(null);
    setPresetKey("");
    setForm(emptyVpnForm);
    setIpsecCredentialId("");
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
        <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
          Supplies {"{{user}}"} and {"{{pass}}"} to the command above.
        </span>
      </Field>
      <Field label="IPsec Profile (optional)">
        <select
          className={inputClass}
          value={ipsecCredentialId}
          onChange={(e) => setIpsecCredentialId(e.target.value)}
        >
          <option value="">None</option>
          {ipsecCredentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.ikeMode})
            </option>
          ))}
        </select>
        <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
          {ipsecCredentials.length === 0 ? (
            <>
              None defined yet — add one on the{" "}
              <span className="text-ink-muted">IPsec</span> tab. Only needed
              for IKEv1/IKEv2 tunnels; an openfortivpn/SSL VPN uses the
              Credential above instead.
            </>
          ) : (
            <>
              Supplies the {"{{ipsec…}}"} placeholders to the command above
              (see the IPsec tab for the full list). Changing this rebuilds
              the container on save.
            </>
          )}
        </span>
      </Field>
      {(() => {
        // The owning project is implicit (the active one for a new VPN, the
        // stored one when editing) -- only the *other* projects are
        // shareable, so it isn't offered as a checkbox against itself.
        const ownerId = form.projectId ?? activeProjectId;
        const shareable = projects.filter((p) => p.id !== ownerId);
        if (shareable.length === 0) return null;
        return (
          <Field label="Also available in">
            <div className="flex flex-col gap-1 rounded border border-border bg-surface p-2">
              {shareable.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 text-xs text-ink"
                >
                  <input
                    type="checkbox"
                    checked={form.sharedProjectIds.includes(p.id)}
                    onChange={() => toggleShare(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
              The same tunnel shows up in these projects too, for members of
              each. It stays owned by{" "}
              {projects.find((p) => p.id === ownerId)?.name ?? "Unassigned"},
              which is the only project it can be deleted from.
            </span>
          </Field>
        );
      })()}
      {containerResult && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] leading-relaxed text-red-400">
          <div className="mb-1 font-bold uppercase tracking-widest">
            Container failed to build
          </div>
          <pre className="whitespace-pre-wrap break-all">
            {containerResult.stderr || containerResult.error || `exit code ${containerResult.exitCode}`}
          </pre>
        </div>
      )}
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
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs text-ink">{v.name}</span>
                    {/* Shown only when you're looking at a project that
                        borrowed this VPN rather than owning it -- deleting
                        it from here is not yours to do. */}
                    {(v.projectId ?? "") !== activeProjectId && (
                      <span
                        className="shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-widest text-ink-faint"
                        title={`Owned by ${
                          projects.find((p) => p.id === v.projectId)?.name ??
                          "Unassigned"
                        }`}
                      >
                        shared
                      </span>
                    )}
                  </div>
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

const SERVICE_TYPES = ["Docker", "Node", "LXC"];

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
  const emptyForm = { name: "", type: SERVICE_TYPES[0], hostId: "" };
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
    <DiscoverServices
      hosts={hosts}
      services={services}
      onCreate={onCreate}
    />
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
          {SERVICE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {/* Keep a retired type (e.g. an older "Nginx" service) selectable
              while editing it, so opening the form doesn't silently blank
              the field and rewrite the record on save. */}
          {!SERVICE_TYPES.includes(form.type) && (
            <option value={form.type}>{form.type}</option>
          )}
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
