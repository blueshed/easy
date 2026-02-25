import { SCHEMAS, type SchemaDefinition, type ChildDef } from "./schemas";

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}

export function validate(schemaName: string, obj: Record<string, unknown>, isChild = false): void {
    const schema = SCHEMAS[schemaName];
    if (!schema) throw new ValidationError(`Unknown schema '${schemaName}'`);

    // 1. Validate natural keys (only for root schemas, children get parent context implicitly)
    if (!isChild) {
        for (const nk of schema.naturalKey) {
            if (schema.columns[nk] || schema.fks.find((fk) => fk.field === nk)) {
                if (obj[nk] === undefined || obj[nk] === null) {
                    throw new ValidationError(`Schema '${schemaName}' is missing required natural key '${nk}'.`);
                }
            }
        }
    }

    // 2. Validate columns
    for (const [jsonKey, sqlCol] of Object.entries(schema.columns)) {
        if (jsonKey in obj) {
            const val = obj[jsonKey];
            if (val === null || val === undefined) continue;

            // Type checks
            if (schema.booleans?.includes(jsonKey)) {
                if (typeof val !== "boolean" && val !== 0 && val !== 1) {
                    throw new ValidationError(`Field '${jsonKey}' on '${schemaName}' must be a boolean or 0/1.`);
                }
            } else if (sqlCol === "args") {
                if (typeof val !== "string" && !Array.isArray(val) && typeof val !== "object") {
                    throw new ValidationError(`Field '${jsonKey}' on '${schemaName}' must be a JSON string, array, or object.`);
                }
            } else {
                // Primitive type check fallback (string or number usually)
                if (typeof val !== "string" && typeof val !== "number") {
                    throw new ValidationError(`Field '${jsonKey}' on '${schemaName}' must be a string or number.`);
                }
            }
        }
    }

    // 3. Validate FKs are strings/numbers
    for (const fk of schema.fks) {
        if (fk.field in obj) {
            const val = obj[fk.field];
            if (val !== null && val !== undefined && typeof val !== "string" && typeof val !== "number") {
                throw new ValidationError(`Foreign key '${fk.field}' on '${schemaName}' must be a string or number.`);
            }
        }
    }

    // 4. Validate children recursively
    if (schema.children) {
        for (const childDef of schema.children) {
            if (childDef.key in obj) {
                const childArray = obj[childDef.key];
                if (childArray !== undefined && childArray !== null) {
                    if (!Array.isArray(childArray)) {
                        throw new ValidationError(`Child relation '${childDef.key}' on '${schemaName}' must be an array.`);
                    }

                    for (const item of childArray) {
                        let childObj: Record<string, unknown>;
                        if (typeof item === "string" || typeof item === "number") {
                            if (!childDef.shorthandField) {
                                throw new ValidationError(`Child relation '${childDef.key}' on '${schemaName}' does not support shorthand string/number values.`);
                            }
                            childObj = { [childDef.shorthandField]: item };
                        } else if (typeof item === "object") {
                            childObj = item as Record<string, unknown>;
                        } else {
                            throw new ValidationError(`Invalid item in child array '${childDef.key}' on '${schemaName}'.`);
                        }
                        validate(childDef.schema, childObj, true);
                    }
                }
            }
        }
    }
}
