import { useState } from "react";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import {
  IKE_MODES,
  IPSEC_PLACEHOLDERS,
  type IpsecCredential,
  type IpsecIkeMode,
} from "../../types";
import {
  Field,
  SubmitButton,
  inputClass,
  monoInputClass,
} from "./AddResourcesPanel";

const emptyForm = {
  name: "",
  ikeMode: "ikev2-eap" as IpsecIkeMode,
  psk: "",
  certificate: "",
  privateKey: "",
  passphrase: "",
  gatewayCert: "",
  localId: "",
  remoteId: "",
  username: "",
  password: "",
  ikeProposal: "",
  espProposal: "",
  remoteTs: "",
  localTs: "",
  userland: false,
};

type FormState = typeof emptyForm;

/** Fields the server never sends back, so a blank one can't be told apart
 * from "cleared" without this list. On edit they're omitted when blank. */
const SECRET_FIELDS = [
  "psk",
  "certificate",
  "privateKey",
  "passphrase",
  "password",
] as const;

/**
 * Values are substituted into the VPN's container command *before* its own
 * {{host}}/{{user}}/{{pass}} pass runs, so a value containing "{{" would be
 * re-scanned by that second pass and could be rewritten into something never
 * typed. The server refuses it outright; checking here too turns a 400 into
 * an inline message naming the field that caused it.
 */
function findBraceField(form: FormState): string | null {
  const labelled: [string, string][] = [
    ["Pre-shared key", form.psk],
    ["Client certificate", form.certificate],
    ["Client private key", form.privateKey],
    ["Key passphrase", form.passphrase],
    ["Gateway certificate", form.gatewayCert],
    ["Local ID", form.localId],
    ["Remote ID", form.remoteId],
    ["Username", form.username],
    ["Password", form.password],
    ["IKE proposal", form.ikeProposal],
    ["ESP proposal", form.espProposal],
    ["Remote traffic selector", form.remoteTs],
    ["Local traffic selector", form.localTs],
  ];
  return labelled.find(([, v]) => v.includes("{{"))?.[0] ?? null;
}

export function IpsecCredentialForm({
  ipsecCredentials,
  onCreate,
  onUpdate,
  onDelete,
}: {
  ipsecCredentials: IpsecCredential[];
  onCreate: (credential: Omit<IpsecCredential, "id">) => Promise<void>;
  onUpdate: (
    id: string,
    credential: Partial<Omit<IpsecCredential, "id">>,
  ) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mode = IKE_MODES.find((m) => m.value === form.ikeMode) ?? IKE_MODES[0];
  const { psk: needsPsk, login: needsLogin, clientCert: needsCert } = mode.needs;
  // In EAP and certificate modes the gateway authenticates with a
  // certificate, so a self-signed one has to be pinned or the handshake is
  // rejected outright. PSK modes never look at it.
  const usesGatewayCert =
    form.ikeMode === "ikev2-eap" || form.ikeMode === "ikev2-cert";

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(cred: IpsecCredential) {
    setEditingId(cred.id);
    setError(null);
    setForm({
      name: cred.name,
      ikeMode: cred.ikeMode,
      // Secrets come back blank from the server by design. Left blank they
      // stay blank on save, and the merge keeps the stored value.
      psk: "",
      certificate: "",
      privateKey: "",
      passphrase: "",
      password: "",
      // Not a secret: the gateway presents it to every client, and seeing
      // whether an anchor is pinned is exactly what you want when a
      // phase-1 is failing.
      gatewayCert: cred.gatewayCert ?? "",
      localId: cred.localId ?? "",
      remoteId: cred.remoteId ?? "",
      username: cred.username ?? "",
      ikeProposal: cred.ikeProposal ?? "",
      espProposal: cred.espProposal ?? "",
      remoteTs: cred.remoteTs ?? "",
      localTs: cred.localTs ?? "",
      userland: cred.userland ?? false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const braced = findBraceField(form);
    if (braced) {
      setError(`${braced} must not contain "{{".`);
      return;
    }
    // On create there is nothing stored to fall back on, so the material the
    // chosen mode needs has to be present now. On edit, blank means "keep
    // what's stored" and the server re-validates the merged record.
    if (!editingId) {
      if (needsPsk && !form.psk.trim()) {
        setError(`${mode.label} needs a pre-shared key.`);
        return;
      }
      if (needsLogin && (!form.username.trim() || !form.password.trim())) {
        setError(`${mode.label} needs both a username and a password.`);
        return;
      }
      if (needsCert && (!form.certificate.trim() || !form.privateKey.trim())) {
        setError(
          `${mode.label} needs both a client certificate and a private key.`,
        );
        return;
      }
    }
    setError(null);

    const payload: Partial<Omit<IpsecCredential, "id">> = {
      name: form.name,
      ikeMode: form.ikeMode,
      gatewayCert: form.gatewayCert,
      localId: form.localId,
      remoteId: form.remoteId,
      username: form.username,
      ikeProposal: form.ikeProposal,
      espProposal: form.espProposal,
      remoteTs: form.remoteTs,
      localTs: form.localTs,
      userland: form.userland,
    };
    // A blank secret on an edit is omitted entirely, so the server's merge
    // keeps what's stored. Sending "" would explicitly wipe it -- which is
    // what would happen every time someone edited an unrelated field, since
    // the server never sent the secret down to begin with.
    for (const key of SECRET_FIELDS) {
      const value = form[key];
      if (value || !editingId) payload[key] = value;
    }

    try {
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onCreate(payload as Omit<IpsecCredential, "id">);
      }
      setEditingId(null);
      setForm(emptyForm);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  const secretHint = editingId ? " — blank keeps the stored value" : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded border border-border bg-surface p-2 text-[10px] leading-relaxed text-ink-faint">
        Credentials for an IPsec tunnel. Separate from SSH credentials because
        a tunnel authenticates with a pre-shared key, a login over EAP/XAuth,
        or an X.509 keypair rather than a plain username and password. Bind a
        profile to a VPN on the <span className="text-ink-muted">VPN</span> tab
        (choose the <span className="text-ink-muted">IPsec / IKEv2</span>{" "}
        preset) and these values reach the container as its{" "}
        <code>VPN_*</code> variables.
      </p>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Field label="Name">
          <input
            required
            placeholder="HQ gateway (IKEv2)"
            className={inputClass}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field label="Authentication Mode">
          <select
            className={inputClass}
            value={form.ikeMode}
            onChange={(e) => set("ikeMode", e.target.value as IpsecIkeMode)}
          >
            {IKE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
            {mode.hint}
          </span>
        </Field>

        {needsPsk && (
          <Field
            label={`${
              form.ikeMode === "ikev1-xauth" ? "Group " : ""
            }Pre-Shared Key${secretHint}`}
          >
            <input
              type="password"
              className={inputClass}
              value={form.psk}
              onChange={(e) => set("psk", e.target.value)}
            />
          </Field>
        )}

        {needsLogin && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <input
                className={monoInputClass}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Field>
            <Field label={`Password${secretHint}`}>
              <input
                type="password"
                className={inputClass}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Field>
          </div>
        )}

        {needsCert && (
          <>
            <Field label={`Client Certificate (PEM)${secretHint}`}>
              <textarea
                rows={4}
                spellCheck={false}
                placeholder="-----BEGIN CERTIFICATE-----"
                className={`${monoInputClass} resize-y`}
                value={form.certificate}
                onChange={(e) => set("certificate", e.target.value)}
              />
            </Field>
            <Field label={`Client Private Key (PEM)${secretHint}`}>
              <textarea
                rows={4}
                spellCheck={false}
                placeholder="-----BEGIN PRIVATE KEY-----"
                className={`${monoInputClass} resize-y`}
                value={form.privateKey}
                onChange={(e) => set("privateKey", e.target.value)}
              />
            </Field>
            <Field label={`Key Passphrase${secretHint}`}>
              <input
                type="password"
                className={inputClass}
                value={form.passphrase}
                onChange={(e) => set("passphrase", e.target.value)}
              />
              <span className="mt-1 text-[10px] leading-relaxed text-amber-400">
                The bundled ipsec-vpn image loads keys with{" "}
                <code>swanctl --noprompt</code> and cannot decrypt an
                encrypted key. Supply an unencrypted key for that image.
              </span>
            </Field>
          </>
        )}

        {usesGatewayCert && (
          <Field label="Gateway Certificate / CA (PEM, optional)">
            <textarea
              rows={3}
              spellCheck={false}
              placeholder="-----BEGIN CERTIFICATE-----"
              className={`${monoInputClass} resize-y`}
              value={form.gatewayCert}
              onChange={(e) => set("gatewayCert", e.target.value)}
            />
            <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
              Needed only when the gateway's certificate doesn't chain to a
              public CA. IPsec has no "accept anyway" — the certificate
              arrives inside IKE_AUTH and can't be inspected beforehand — so a
              self-signed gateway is unusable until you paste its certificate
              here. It acts as its own trust anchor.
            </span>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Local ID">
            <input
              placeholder="defaults to the username"
              className={monoInputClass}
              value={form.localId}
              onChange={(e) => set("localId", e.target.value)}
            />
          </Field>
          <Field label="Remote ID">
            <input
              placeholder="defaults to the gateway host"
              className={monoInputClass}
              value={form.remoteId}
              onChange={(e) => set("remoteId", e.target.value)}
            />
          </Field>
        </div>
        <span className="-mt-1 text-[10px] leading-relaxed text-ink-faint">
          The IKE identities (leftid / rightid). When the gateway is reached
          by IP the certificate almost never matches it — set Remote ID to the
          identity actually inside the certificate, or <code>%any</code> to
          accept whatever it presents once the certificate itself is trusted.
        </span>

        <Field label="Routed Subnets (remote traffic selector)">
          <input
            placeholder="10.0.0.0/8,192.168.0.0/16"
            className={monoInputClass}
            value={form.remoteTs}
            onChange={(e) => set("remoteTs", e.target.value)}
          />
        </Field>
        {!form.remoteTs.trim() && (
          <div className="-mt-1 flex gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-400">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <span>
              Leave this empty and the tunnel claims{" "}
              <code>0.0.0.0/0</code> — everything. The container runs with{" "}
              <code>--net=host</code> (it has to: davy-jones reaches hosts
              behind a VPN directly, not through the container), so a
              full-tunnel route is installed on this whole machine and can cut
              off its own SSH and web access. List only the subnets that live
              behind this gateway.
            </span>
          </div>
        )}

        <Field label="Local Traffic Selector (optional)">
          <input
            placeholder="dynamic"
            className={monoInputClass}
            value={form.localTs}
            onChange={(e) => set("localTs", e.target.value)}
          />
          <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
            Empty means the virtual IP the gateway assigns, which is nearly
            always what you want.
          </span>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="IKE Proposal (phase 1)">
            <input
              placeholder="aes256-sha256-modp2048"
              className={monoInputClass}
              value={form.ikeProposal}
              onChange={(e) => set("ikeProposal", e.target.value)}
            />
          </Field>
          <Field label="ESP Proposal (phase 2)">
            <input
              placeholder="aes256-sha256"
              className={monoInputClass}
              value={form.espProposal}
              onChange={(e) => set("espProposal", e.target.value)}
            />
          </Field>
        </div>
        <span className="-mt-1 text-[10px] leading-relaxed text-ink-faint">
          Left empty, the client's own defaults apply.
        </span>

        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={form.userland}
            onChange={(e) => set("userland", e.target.checked)}
          />
          Userland ESP
        </label>
        <span className="-mt-2 text-[10px] leading-relaxed text-ink-faint">
          Handles encryption in userspace (strongSwan's kernel-libipsec)
          instead of the kernel's XFRM stack. Turn this on only if the tunnel
          fails to install policy — some kernels and nested-virtualisation
          hosts have no usable XFRM.
        </span>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <SubmitButton
            label={editingId ? "Update IPsec Profile" : "Add IPsec Profile"}
          />
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

      {ipsecCredentials.length > 0 && (
        <div>
          <div className="section-header mb-2">Existing IPsec Profiles</div>
          <div className="flex flex-col gap-1.5">
            {ipsecCredentials.map((c) => {
              const label =
                IKE_MODES.find((m) => m.value === c.ikeMode)?.value ??
                c.ikeMode;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-ink">{c.name}</div>
                    <div className="truncate font-mono text-[11px] text-ink-faint">
                      {label}
                      {c.remoteTs ? ` · ${c.remoteTs}` : " · full tunnel"}
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

      <div>
        <div className="section-header mb-2">Command Placeholders</div>
        <div className="flex flex-wrap gap-1">
          {IPSEC_PLACEHOLDERS.map((p) => (
            <code
              key={p}
              className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-faint"
            >
              {p}
            </code>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
          Usable in the container command of any VPN this profile is bound to.
          Each is replaced with a shell-escaped value at provision time; a
          placeholder on a VPN with no profile bound resolves to an empty
          string. Prefer the <code>…B64</code> variants for certificates and
          keys — multi-line PEM does not survive{" "}
          <code>docker run -e</code> intact.
        </p>
      </div>
    </div>
  );
}
