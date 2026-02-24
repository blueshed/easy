export const REFERENCE = [
  {
    title: "Entities",
    description: "Entities map to database tables. Every entity needs an id: number field.",
    commands: [
      { syntax: "add-entity <Name>", description: "Create a new entity." },
      { syntax: "add-field <Entity> <field> [type]", description: "Add a field to an entity. Type defaults to string.", example: "add-field User email string" },
      { syntax: "add-relation <From> <To> [label] [cardinality]", description: "Add a relation between entities. Cardinality: * (has-many, default) or 1 (belongs-to).", example: "add-relation User Project owner 1" },
      { syntax: "remove-entity <Name>", description: "Remove an entity and all its fields, methods, and story links." },
      { syntax: "remove-field <Entity> <field>", description: "Remove a field from an entity." },
      { syntax: "remove-relation <From> <To> [label]", description: "Remove a relation." },
    ],
  },
  {
    title: "Stories",
    description: "User stories describe what actors can do in the system.",
    commands: [
      { syntax: "add-story <actor> <action> [description]", description: "Add a user story.", example: 'add-story manager "create projects" "to organise work"' },
      { syntax: "remove-story <id>", description: "Remove a story by ID." },
    ],
  },
  {
    title: "Documents",
    description: "Documents are subscription units \u2014 clients open a document and receive merge events for changes within it.",
    commands: [
      { syntax: "add-document <Name> <Entity> [flags]", description: "Create a document rooted on an entity.", flags: ["--collection", "--public", "--cursor", "--stream", "--description <text>"], example: 'add-document TaskList Task --collection --public --description "All tasks"' },
      { syntax: "remove-document <Name>", description: "Remove a document and its expansions." },
    ],
  },
  {
    title: "Expansions",
    description: "Expansions define which child entities are loaded with a document. Three types: has-many (default), belongs-to, and shallow.",
    commands: [
      { syntax: "add-expansion <Document> <name> <Entity> <foreign_key> [flags]", description: "Add a child expansion to a document.", flags: ["--belongs-to", "--shallow", "--parent <expansion_name>"], example: "add-expansion ProjectDoc tasks Task project_id" },
      { syntax: "remove-expansion <Document> <name>", description: "Remove an expansion." },
    ],
  },
  {
    title: "Methods",
    description: "Methods are RMI handlers on entities. Args are a JSON array of {name, type} objects.",
    commands: [
      { syntax: "add-method <Entity> <name> [args_json] [return_type] [flags]", description: "Add a method to an entity. Defaults: args=[], return_type=boolean.", flags: ["--no-auth", "--permission <path>"], example: 'add-method Room sendMessage \'[{"name":"body","type":"string"}]\' boolean' },
      { syntax: "remove-method <Entity> <name>", description: "Remove a method and its story links, publishes, and permissions." },
    ],
  },
  {
    title: "Publish / Notify",
    description: "Publish declares which fields a method changes. Notifications are cross-document alerts.",
    commands: [
      { syntax: "add-publish <Entity.method> <property>", description: "Declare that a method publishes a field in its merge event payload.", example: "add-publish Room.rename name" },
      { syntax: "remove-publish <Entity.method> <property>", description: "Remove a publish declaration." },
      { syntax: "add-notification <Entity.method> <channel> <recipients> [payload_json]", description: "Declare that a method sends a notification.", example: 'add-notification Task.assign task-assigned assignee_id \'{"task_id":"number"}\'' },
      { syntax: "remove-notification <Entity.method> <channel>", description: "Remove a notification." },
    ],
  },
  {
    title: "Permissions",
    description: "Permission paths use fkey path syntax to express who can call a method. Path syntax: @field->table[filter]{temporal}.target_field. Multiple paths on the same method use OR logic.",
    commands: [
      { syntax: "add-permission <Entity.method> <path> [description]", description: "Add a permission path to a method.", example: 'add-permission Venue.addArea "@venue_id->acts_for[org_id=$]{active}.user_id" "Active org member"' },
      { syntax: "remove-permission <id>", description: "Remove a permission path by its ID." },
    ],
  },
  {
    title: "Story Links",
    description: "Connect stories to the artifacts they produce. Target types: entity, document, method.",
    commands: [
      { syntax: "link-story <story_id> <target_type> <target_name>", description: "Link a story to an entity, document, or method.", example: "link-story 1 document RoomList" },
      { syntax: "unlink-story <story_id> <target_type> <target_name>", description: "Remove a story link." },
    ],
  },
  {
    title: "Checklists",
    description: "Checklists verify that permission paths work. CAN checks prove the right actor succeeds. DENIED checks prove the wrong actor is blocked. Confirmation: --api (integration test) and --ux (browser test).",
    commands: [
      { syntax: "add-checklist <name> [description]", description: "Create a named checklist." },
      { syntax: "remove-checklist <name>", description: "Remove a checklist and all its checks." },
      { syntax: "add-check <checklist> <actor> <Entity.method> [description] [flags]", description: "Add a check step.", flags: ["--denied", "--after <check_id>"] },
      { syntax: "remove-check <check_id>", description: "Remove a check by ID." },
      { syntax: "add-check-dep <check_id> <depends_on_id>", description: "Add an ordering dependency between checks." },
      { syntax: "remove-check-dep <check_id> <depends_on_id>", description: "Remove a check dependency." },
      { syntax: "confirm-check <check_id> --api|--ux", description: "Mark a check as confirmed for api or ux testing." },
      { syntax: "unconfirm-check <check_id> --api|--ux", description: "Unmark a confirmation." },
      { syntax: "list-checks [checklist]", description: "List all checks, optionally filtered by checklist name." },
    ],
  },
  {
    title: "Metadata",
    description: "Key-value store for project-level settings like theme, app name, etc.",
    commands: [
      { syntax: "set-meta <key> <value>", description: "Set a metadata value." },
      { syntax: "get-meta [key]", description: "Get a value, or list all metadata if key is omitted." },
      { syntax: "clear-meta <key>", description: "Remove a metadata entry." },
      { syntax: "set-theme <description>", description: "Shortcut for set-meta theme." },
      { syntax: "get-theme", description: "Shortcut for get-meta theme." },
      { syntax: "clear-theme", description: "Shortcut for clear-meta theme." },
    ],
  },
  {
    title: "Listing",
    description: "View the current model.",
    commands: [
      { syntax: "list", description: "List all entities, fields, methods, and relations." },
      { syntax: "list-stories", description: "List all stories with their links." },
      { syntax: "list-documents", description: "List all documents with their expansion trees." },
    ],
  },
  {
    title: "Export",
    description: "Export the model as a markdown specification for use with Simple's /implement skill.",
    commands: [
      { syntax: "export-spec", description: "Print the full application spec as markdown to stdout.", example: "export-spec > spec.md" },
    ],
  },
  {
    title: "Maintenance",
    description: "Diagnose and repair the model database.",
    commands: [
      { syntax: "doctor", description: "Report orphaned references (story links, checks, check deps)." },
      { syntax: "doctor --fix", description: "Remove all orphaned references." },
    ],
  },
  {
    title: "Batch",
    description: "Pipe JSONL to stdin to run many commands in one call. Each line is a JSON array: [\"command\", \"arg1\", ...].",
    commands: [
      { syntax: "batch", description: "Read JSONL commands from stdin and execute them sequentially.", example: 'echo \'["add-entity","Room"]\' | bun model batch' },
    ],
  },
];
