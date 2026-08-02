import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type {
  Credential,
  Host,
  SavedCommand,
  Service,
  Vpn,
} from "../types";

export function useInfraData(projectId: string) {
  const [vpns, setVpns] = useState<Vpn[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [v, h, s, c, sc] = await Promise.all([
        api.vpns.list(projectId),
        api.hosts.list(projectId),
        api.services.list(projectId),
        api.credentials.list(projectId),
        api.savedCommands.list(),
      ]);
      setVpns(v);
      setHosts(h);
      setServices(s);
      setCredentials(c);
      setSavedCommands(sc);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createVpn = useCallback(
    async (vpn: Omit<Vpn, "id">) => {
      await api.vpns.create({ ...vpn, projectId });
      await reload();
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
  const updateCredential = useCallback(
    async (id: string, credential: Omit<Credential, "id">) => {
      await api.credentials.update(id, credential);
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
    savedCommands,
    loading,
    error,
    reload,
    createVpn,
    createHost,
    createService,
    createCredential,
    updateCredential,
    createSavedCommand,
    deleteVpn,
    deleteHost,
    deleteService,
    deleteCredential,
    deleteSavedCommand,
  };
}
