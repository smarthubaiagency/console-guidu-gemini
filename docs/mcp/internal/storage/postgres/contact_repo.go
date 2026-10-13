package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cartaopro/mcp/internal/domain"
)

// ContactRepo is the RLS-backed data-access layer for the Contact model.
// Every mutation MUST execute inside a BeginTenant transaction so that
// `app.current_workspace_id` is enforced at the database layer.
type ContactRepo struct {
	pool *pgxpool.Pool
}

// NewContactRepo creates a new ContactRepo backed by the given pool.
func NewContactRepo(pool *pgxpool.Pool) *ContactRepo {
	return &ContactRepo{pool: pool}
}

// Create inserts a new Contact record and returns the persisted entity.
//
// RLS guarantee: the INSERT runs inside a BeginTenant transaction.
func (r *ContactRepo) Create(ctx context.Context, input domain.ContactCreateInput) (domain.Contact, error) {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return domain.Contact{}, fmt.Errorf("contact_repo.create: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var metadataJSON []byte
	if input.Metadata != nil {
		metadataJSON, err = json.Marshal(input.Metadata)
		if err != nil {
			return domain.Contact{}, fmt.Errorf("contact_repo.create: marshal metadata: %w", err)
		}
	}

	source := input.Source
	if source == "" {
		source = "ai_agent"
	}

	const q = `-- Guardrail: workspace scoped query. Do not remove tenant filter.
INSERT INTO "Contact" (
    "id",
    "workspaceId",
    "fullName",
    "firstName",
    "lastName",
    "email",
    "phone",
    "whatsapp",
    "source",
    "lifecycleStage",
    "metadata",
    "assistantId",
    "aiExecutionId",
    "createdAt",
    "updatedAt"
) VALUES (
    gen_random_uuid(),
    $1, $2, $3, $4, $5, $6, $7, $8,
    'LEAD',
    $9, $10, $11,
    NOW(), NOW()
)
RETURNING "id", "workspaceId", "fullName", "firstName", "lastName",
          "email", "phone", "whatsapp", "source", "lifecycleStage",
          "metadata", "assistantId", "aiExecutionId", "createdAt", "updatedAt"`

	var c domain.Contact
	var metaRaw []byte
	row := tx.QueryRow(ctx, q,
		input.WorkspaceID,
		input.FullName,
		input.FirstName,
		input.LastName,
		input.Email,
		input.Phone,
		input.Whatsapp,
		source,
		nullableJSON(metadataJSON),
		input.AssistantID,
		input.AiExecutionID,
	)

	var assistantID, aiExecID *uuid.UUID
	if err := row.Scan(
		&c.ID, &c.WorkspaceID, &c.FullName, &c.FirstName, &c.LastName,
		&c.Email, &c.Phone, &c.Whatsapp, &c.Source, &c.LifecycleStage,
		&metaRaw, &assistantID, &aiExecID,
		&c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return domain.Contact{}, fmt.Errorf("contact_repo.create: scan: %w", err)
	}

	c.AssistantID = assistantID
	c.AiExecutionID = aiExecID
	if metaRaw != nil {
		if err := json.Unmarshal(metaRaw, &c.Metadata); err != nil {
			return domain.Contact{}, fmt.Errorf("contact_repo.create: unmarshal metadata: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Contact{}, fmt.Errorf("contact_repo.create: commit: %w", err)
	}

	return c, nil
}

// Update applies a partial update to the Contact with the given id.
// Only non-nil fields in the input are updated. The updatedAt timestamp
// is always refreshed.
//
// RLS guarantee: the UPDATE runs inside a BeginTenant transaction.
func (r *ContactRepo) Update(ctx context.Context, id uuid.UUID, input domain.ContactUpdateInput) (domain.Contact, error) {
	tx, err := BeginTenant(ctx, r.pool)
	if err != nil {
		return domain.Contact{}, fmt.Errorf("contact_repo.update: begin tenant: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	setClauses := []string{`"updatedAt" = NOW()`}
	args := []any{}
	argIdx := 1

	appendArg := func(col string, val any) {
		setClauses = append(setClauses, fmt.Sprintf(`"%s" = $%d`, col, argIdx))
		args = append(args, val)
		argIdx++
	}

	if input.FullName != nil {
		appendArg("fullName", *input.FullName)
	}
	if input.FirstName != nil {
		appendArg("firstName", *input.FirstName)
	}
	if input.LastName != nil {
		appendArg("lastName", *input.LastName)
	}
	if input.Email != nil {
		appendArg("email", *input.Email)
	}
	if input.Phone != nil {
		appendArg("phone", *input.Phone)
	}
	if input.Whatsapp != nil {
		appendArg("whatsapp", *input.Whatsapp)
	}
	if input.Source != nil {
		appendArg("source", *input.Source)
	}
	if input.Metadata != nil {
		metaJSON, err := json.Marshal(input.Metadata)
		if err != nil {
			return domain.Contact{}, fmt.Errorf("contact_repo.update: marshal metadata: %w", err)
		}
		appendArg("metadata", metaJSON)
	}

	if len(setClauses) == 1 {
		// Only the timestamp clause — nothing meaningful to update.
		return domain.Contact{}, fmt.Errorf("contact_repo.update: no fields provided")
	}

	// WHERE clause uses the next arg index.
	args = append(args, id)
	whereIdx := argIdx

	q := fmt.Sprintf(`-- Guardrail: workspace scoped query. Do not remove tenant filter.
UPDATE "Contact"
SET %s
WHERE id = $%d
RETURNING "id", "workspaceId", "fullName", "firstName", "lastName",
          "email", "phone", "whatsapp", "source", "lifecycleStage",
          "metadata", "assistantId", "aiExecutionId", "createdAt", "updatedAt"`,
		strings.Join(setClauses, ", "), whereIdx)

	var c domain.Contact
	var metaRaw []byte
	var assistantID, aiExecID *uuid.UUID
	var createdAt, updatedAt time.Time

	row := tx.QueryRow(ctx, q, args...)
	if err := row.Scan(
		&c.ID, &c.WorkspaceID, &c.FullName, &c.FirstName, &c.LastName,
		&c.Email, &c.Phone, &c.Whatsapp, &c.Source, &c.LifecycleStage,
		&metaRaw, &assistantID, &aiExecID,
		&createdAt, &updatedAt,
	); err != nil {
		return domain.Contact{}, fmt.Errorf("contact_repo.update: scan: %w", err)
	}

	c.AssistantID = assistantID
	c.AiExecutionID = aiExecID
	c.CreatedAt = createdAt
	c.UpdatedAt = updatedAt
	if metaRaw != nil {
		if err := json.Unmarshal(metaRaw, &c.Metadata); err != nil {
			return domain.Contact{}, fmt.Errorf("contact_repo.update: unmarshal metadata: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Contact{}, fmt.Errorf("contact_repo.update: commit: %w", err)
	}

	return c, nil
}

// nullableJSON returns nil when b is empty, otherwise returns b as-is.
// Used to pass NULL for JSON columns when no metadata is provided.
func nullableJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
