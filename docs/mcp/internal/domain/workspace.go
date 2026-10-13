package domain

import (
	"time"

	"github.com/google/uuid"
)

// Workspace mirrors the minimal fields of the Prisma model `Workspace`
// required for the workspace.context.get tool.
type Workspace struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	CreatedAt time.Time `json:"createdAt"`
}

// WorkspaceContext is the output of workspace.context.get.
// It combines data from the Workspace and its active subscription.
type WorkspaceContext struct {
	Name     string `json:"name"`
	Plan     string `json:"plan"`
	Timezone string `json:"timezone"`
}
