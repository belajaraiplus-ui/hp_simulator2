// ===============================
// Runtime Power Evaluation Types
// ===============================

export type RailStatus = "OFF" | "ON" | "FAULT";

export type FaultType = "short" | "open" | "disable_regulator";

export type RailFault = {
  type: FaultType;
  note?: string;
};

export type SystemMode = "ALW" | "S0" | "SLEEP" | "OFF";

export type RailRuntime = {
  id: string;

  status: RailStatus;
  voltage_v: number | null;

  reason: {
    decided_by: "default_state" | "enabled_by" | "upstream" | "fault";
    upstream_blocker?: string;
    upstream_status?: RailStatus;
    fault?: RailFault;
  };

  gating: {
    system_mode: SystemMode;
    default_state: SystemMode;
    enabled_by?: string[];
    regulator_ok: boolean;
  };
};

export type PowerRuntime = {
  board_id: string;
  system_mode: SystemMode;
  faults: Record<string, RailFault | undefined>;
  rails: Record<string, RailRuntime>;
  topo_order: string[];
};
