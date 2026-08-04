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

// vpnInProject reports whether a VPN should appear under the given project,
// which is true both for the project that owns it and for any project it has
// been shared into.
func vpnInProject(v Vpn, projectID string) bool {
	if v.ProjectID == projectID {
		return true
	}
	for _, id := range v.SharedProjectIDs {
		if id == projectID {
			return true
		}
	}
	return false
}

// canAccessVpn is canAccessProject widened by sharing: membership of the
// owning project OR of any project the VPN is shared into is enough. Sharing
// a VPN into a project is exactly the act of granting that project's members
// access to it, so this is the intended widening, not a hole -- and only
// someone who can already access a project may share into it (see the
// validation in handlers_config.go).
func canAccessVpn(ctx context.Context, storage *Storage, v Vpn) bool {
	if canAccessProject(ctx, storage, v.ProjectID) {
		return true
	}
	for _, id := range v.SharedProjectIDs {
		if canAccessProject(ctx, storage, id) {
			return true
		}
	}
	return false
}

// canShareInto reports whether the caller may share a VPN into every project
// on its SharedProjectIDs list. Sharing grants that project's members access
// to the VPN, so it can only be done by someone who already belongs there --
// otherwise sharing would be a way to hand out access you don't hold.
func canShareInto(ctx context.Context, storage *Storage, v Vpn) bool {
	for _, id := range v.SharedProjectIDs {
		if !canAccessProject(ctx, storage, id) {
			return false
		}
	}
	return true
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
