package domain

import (
	"time"

	"github.com/google/uuid"
)

// ContactLifecycleStage mirrors the Prisma enum ContactLifecycleStage.
type ContactLifecycleStage string

const (
	ContactLifecycleLead     ContactLifecycleStage = "LEAD"
	ContactLifecycleProspect ContactLifecycleStage = "PROSPECT"
	ContactLifecycleCustomer ContactLifecycleStage = "CUSTOMER"
	ContactLifecycleChurned  ContactLifecycleStage = "CHURNED"
)

// Contact mirrors the Prisma model `Contact` (schema.prisma line 131).
// Only the fields required by the MCP domain tools are included.
// All UUID fields use uuid.UUID for type safety; nullable fields use pointers.
type Contact struct {
	ID             uuid.UUID             `json:"id"`
	WorkspaceID    uuid.UUID             `json:"workspaceId"`
	FullName       string                `json:"fullName"`
	FirstName      *string               `json:"firstName,omitempty"`
	LastName       *string               `json:"lastName,omitempty"`
	Email          *string               `json:"email,omitempty"`
	Phone          *string               `json:"phone,omitempty"`
	Whatsapp       *string               `json:"whatsapp,omitempty"`
	Source         string                `json:"source"`
	LifecycleStage ContactLifecycleStage `json:"lifecycleStage"`
	Metadata       map[string]any        `json:"metadata,omitempty"`
	AssistantID    *uuid.UUID            `json:"assistantId,omitempty"`
	AiExecutionID  *uuid.UUID            `json:"aiExecutionId,omitempty"`
	CreatedAt      time.Time             `json:"createdAt"`
	UpdatedAt      time.Time             `json:"updatedAt"`
}

// ContactCreateInput is the validated input for the contact.create tool.
type ContactCreateInput struct {
	WorkspaceID uuid.UUID
	FullName    string         `json:"fullName"`
	FirstName   *string        `json:"firstName,omitempty"`
	LastName    *string        `json:"lastName,omitempty"`
	Email       *string        `json:"email,omitempty"`
	Phone       *string        `json:"phone,omitempty"`
	Whatsapp    *string        `json:"whatsapp,omitempty"`
	Source      string         `json:"source"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	// AI provenance — set when a contact is created by an AI execution.
	AssistantID   *uuid.UUID
	AiExecutionID *uuid.UUID
}

// ContactUpdateInput holds the mutable fields for the contact.update tool.
// Only non-nil fields are applied in the UPDATE statement.
type ContactUpdateInput struct {
	FullName  *string
	FirstName *string
	LastName  *string
	Email     *string
	Phone     *string
	Whatsapp  *string
	Source    *string
	Metadata  map[string]any
}
