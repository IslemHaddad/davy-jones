import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type {
  Credential,
  Host,
  IpsecCredential,
  SavedCommand,
  Service,
  Vpn,
} from "../types";

export function useInfraData(projectId: string) {
  const [vpns, setVpns] = useState<Vpn[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [ipsecCredentials, setIpsecCredentials] = useState<IpsecCredential[]>(
    [],
  );
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Whether this project's data has ever arrived. It's the difference
  // between "there is nothing to show" and "what's on screen is just stale":
  // a refresh that fails after a good load must not cost the operator the
  // graph they were reading. Reset on a project switch, because the previous
  // project's resources are not this one's.
  const [loadedOnce, setLoadedOnce] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [v, h, s, c, sc, ipsec] = await Promise.all([
        api.vpns.list(projectId),
        api.hosts.list(projectId),
        api.services.list(projectId),
        api.credentials.list(projectId),
        api.savedCommands.list(),
        // Swallowed rather than joined to the others: IPsec is an additive
        // feature, and a backend too old to serve this route (or any other
        // failure isolated to it) must not take the whole graph down with
        // it. An empty list just means the IPsec tab has nothing to show.
        api.ipsecCredentials.list(projectId).catch(() => [] as IpsecCredential[]),
      ]);
      setVpns(v);
      setHosts(h);
      setServices(s);
      setCredentials(c);
      setSavedCommands(sc);
      setIpsecCredentials(ipsec);
      setLoadedOnce(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoadedOnce(false);
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createVpn = useCallback(
    async (vpn: Omit<Vpn, "id">) => {
      const created = await api.vpns.create({
        ...vpn,
        projectId: vpn.projectId ?? projectId,
      });
      await reload();
      return created;
    },
    [reload, projectId],
  );
  const createHost = useCallback(
    async (host: Omit<Host, "id">) => {
      await api.hosts.create({ ...host, projectId });
      await reload();
    },
    [reload, projectId],
  );
  const createService = useCallback(
    async (service: Omit<Service, "id">) => {
      await api.services.create({ ...service, projectId });
      await reload();
    },
    [reload, projectId],
  );
  const createCredential = useCallback(
    async (credential: Omit<Credential, "id">) => {
      await api.credentials.create({ ...credential, projectId });
      await reload();
    },
    [reload, projectId],
  );
  const updateVpn = useCallback(
    async (id: string, vpn: Omit<Vpn, "id">) => {
      // A VPN shared into the active project is still *owned* by another
      // one -- forcing the active project here would silently steal it.
      const updated = await api.vpns.update(id, {
        ...vpn,
        projectId: vpn.projectId ?? projectId,
      });
      await reload();
      return updated;
    },
    [reload, projectId],
  );
  const updateHost = useCallback(
    async (id: string, host: Omit<Host, "id">) => {
      await api.hosts.update(id, { ...host, projectId });
      await reload();
    },
    [reload, projectId],
  );
  const updateService = useCallback(
    async (id: string, service: Omit<Service, "id">) => {
      await api.services.update(id, { ...service, projectId });
      await reload();
    },
    [reload, projectId],
  );
  const updateCredential = useCallback(
    async (id: string, credential: Omit<Credential, "id">) => {
      await api.credentials.update(id, credential);
      await reload();
    },
    [reload],
  );
  const createIpsecCredential = useCallback(
    async (credential: Omit<IpsecCredential, "id">) => {
      await api.ipsecCredentials.create({ ...credential, projectId });
      await reload();
    },
    [reload, projectId],
  );
  // Takes a Partial because the server merges: the form omits a secret it
  // is leaving alone, so absent keys must survive all the way to the wire.
  const updateIpsecCredential = useCallback(
    async (id: string, credential: Partial<Omit<IpsecCredential, "id">>) => {
      await api.ipsecCredentials.update(id, credential);
      await reload();
    },
    [reload],
  );
  const deleteIpsecCredential = useCallback(
    async (id: string) => {
      await api.ipsecCredentials.remove(id);
      await reload();
    },
    [reload],
  );

  const createSavedCommand = useCallback(
    async (cmd: Omit<SavedCommand, "id">) => {
      await api.savedCommands.create(cmd);
      await reload();
    },
    [reload],
  );

  const deleteVpn = useCallback(
    async (id: string) => {
      await api.vpns.remove(id);
      await reload();
    },
    [reload],
  );
  const deleteHost = useCallback(
    async (id: string) => {
      await api.hosts.remove(id);
      await reload();
    },
    [reload],
  );
  const deleteService = useCallback(
    async (id: string) => {
      await api.services.remove(id);
      await reload();
    },
    [reload],
  );
  const deleteCredential = useCallback(
    async (id: string) => {
      await api.credentials.remove(id);
      await reload();
    },
    [reload],
  );
  const deleteSavedCommand = useCallback(
    async (id: string) => {
      await api.savedCommands.remove(id);
      await reload();
    },
    [reload],
  );

  return {
    vpns,
    hosts,
    services,
    credentials,
    ipsecCredentials,
    savedCommands,
    loading,
    error,
    loadedOnce,
    reload,
    createVpn,
    createHost,
    createService,
    createCredential,
    updateVpn,
    updateHost,
    updateService,
    updateCredential,
    createIpsecCredential,
    updateIpsecCredential,
    deleteIpsecCredential,
    createSavedCommand,
    deleteVpn,
    deleteHost,
    deleteService,
    deleteCredential,
    deleteSavedCommand,
  };
}
