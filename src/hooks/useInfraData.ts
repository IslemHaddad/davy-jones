import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type {
  Credential,
  Host,
  SavedCommand,
  Service,
  Vpn,
} from "../types";

export function useInfraData() {
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
        api.vpns.list(),
        api.hosts.list(),
        api.services.list(),
        api.credentials.list(),
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
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createVpn = useCallback(
    async (vpn: Omit<Vpn, "id">) => {
      await api.vpns.create(vpn);
      await reload();
    },
    [reload],
  );
  const createHost = useCallback(
    async (host: Omit<Host, "id">) => {
      await api.hosts.create(host);
      await reload();
    },
    [reload],
  );
  const createService = useCallback(
    async (service: Omit<Service, "id">) => {
      await api.services.create(service);
      await reload();
    },
    [reload],
  );
  const createCredential = useCallback(
    async (credential: Omit<Credential, "id">) => {
      await api.credentials.create(credential);
      await reload();
    },
    [reload],
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
