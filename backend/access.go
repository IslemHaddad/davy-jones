package main

import (
	"context"
	"net/http"
)

func isProjectMember(p Project, userID string) bool {
	if len(p.MemberIDs) == 0 {
		// Projects created before membership existed have no members
		// recorded at all -- treat that as open to everyone (same as
		// "Unassigned") instead of orphaning them from their own
		// creator. This can't recur for new data: every project gets
		// its creator seeded as a member at creation time (see
		// handlers_projects.go), so an empty list only ever means
		// "predates this feature," not "deliberately locked to no one."
		return true
	}
	for _, id := range p.MemberIDs {
		if id == userID {
			return true
		}
	}
	return false
}

func findProject(ctx context.Context, storage *Storage, id string) (Project, bool) {
	projects, err := storage.GetProjects(ctx)
	if err != nil {
		return Project{}, false
	}
	for _, p := range projects {
		if p.ID == id {
			return p, true
		}
	}
	return Project{}, false
}

// canAccessProject reports whether the caller may see or touch resources
// tagged with the given project ID. "" (Unassigned) is open to everyone,
// since there's no owner to restrict it to. A projectID that no longer
// resolves to an existing project is treated the same way -- open --
// rather than hard-failing on orphaned data (e.g. a project deleted out
// from under a resource that still references its old ID).
func canAccessProject(ctx context.Context, storage *Storage, projectID string) bool {
	if projectID == "" {
		return true
	}
	p, ok := findProject(ctx, storage, projectID)
	if !ok {
		return true
	}
	userID, _, _ := userFromContext(ctx)
	return isProjectMember(p, userID)
}

func writeProjectForbidden(w http.ResponseWriter) {
	writeError(w, http.StatusForbidden, "not a member of this project")
}

// canAccessHost mirrors canAccessProject for resources (like SavedCommand)
// that are scoped to a host rather than carrying their own ProjectID
// directly. A host ID that no longer resolves to an existing host is
// treated as accessible, same rationale as canAccessProject's own fallback.
func canAccessHost(ctx context.Context, storage *Storage, hostID string) bool {
	host, ok := findHost(ctx, storage, hostID)
	if !ok {
		return true
	}
	return canAccessProject(ctx, storage, host.ProjectID)
}
