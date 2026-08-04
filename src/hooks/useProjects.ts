import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Project } from "../types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setProjects(await api.projects.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createProject = useCallback(
    async (project: Omit<Project, "id" | "createdAt">) => {
      const created = await api.projects.create(project);
      await reload();
      return created;
    },
    [reload],
  );
  const updateProject = useCallback(
    async (id: string, project: Omit<Project, "id" | "createdAt">) => {
      await api.projects.update(id, project);
      await reload();
    },
    [reload],
  );
  const deleteProject = useCallback(
    async (id: string) => {
      await api.projects.remove(id);
      await reload();
    },
    [reload],
  );

  return {
    projects,
    loading,
    reload,
    createProject,
    updateProject,
    deleteProject,
  };
}
