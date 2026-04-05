/** Graph data — shared between server and client. */
export type Task = {
  id: number;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "done";
};

export type Dep = {
  task_id: number;
  depends_on: number;
};

export type Flag = {
  name: string;
  status: "pass" | "fail" | "unknown";
};

export type Graph = {
  tasks: Task[];
  deps: Dep[];
  flags: Flag[];
};
