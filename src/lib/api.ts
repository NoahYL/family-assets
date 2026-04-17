import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountInput,
  DashboardSummary,
  Holding,
  HoldingInput,
  HoldingView,
  Instrument,
  InstrumentInput,
  OptionCloseInput,
  OptionDashboard,
  OptionTrade,
  OptionTradeInput,
  OptionTradeView,
  RefreshReport,
  Snapshot,
} from "./types";

export const api = {
  // accounts
  listAccounts: () => invoke<Account[]>("list_accounts"),
  createAccount: (input: AccountInput) =>
    invoke<Account>("create_account", { input }),
  updateAccount: (id: number, input: AccountInput) =>
    invoke<Account>("update_account", { id, input }),
  deleteAccount: (id: number) => invoke<void>("delete_account", { id }),

  // instruments
  listInstruments: () => invoke<Instrument[]>("list_instruments"),
  createInstrument: (input: InstrumentInput) =>
    invoke<Instrument>("create_instrument", { input }),
  updateInstrument: (id: number, input: InstrumentInput) =>
    invoke<Instrument>("update_instrument", { id, input }),
  deleteInstrument: (id: number) => invoke<void>("delete_instrument", { id }),

  // holdings
  listHoldings: () => invoke<HoldingView[]>("list_holdings"),
  createHolding: (input: HoldingInput) =>
    invoke<Holding>("create_holding", { input }),
  updateHolding: (id: number, input: HoldingInput) =>
    invoke<Holding>("update_holding", { id, input }),
  deleteHolding: (id: number) => invoke<void>("delete_holding", { id }),

  // dashboard / snapshots / refresh
  getDashboard: () => invoke<DashboardSummary>("get_dashboard"),
  listSnapshots: (limit?: number) =>
    invoke<Snapshot[]>("list_snapshots", { limit: limit ?? null }),
  deleteSnapshot: (id: number) => invoke<void>("delete_snapshot", { id }),
  refreshAll: () => invoke<RefreshReport>("refresh_all"),

  // options
  listOptionTrades: () => invoke<OptionTradeView[]>("list_option_trades"),
  createOptionTrade: (input: OptionTradeInput) =>
    invoke<OptionTrade>("create_option_trade", { input }),
  updateOptionTrade: (id: number, input: OptionTradeInput) =>
    invoke<OptionTrade>("update_option_trade", { id, input }),
  markOptionExpired: (id: number) =>
    invoke<OptionTrade>("mark_option_expired", { id }),
  closeOptionTrade: (id: number, input: OptionCloseInput) =>
    invoke<OptionTrade>("close_option_trade", { id, input }),
  markOptionAssigned: (id: number) =>
    invoke<OptionTrade>("mark_option_assigned", { id }),
  markOptionRolled: (id: number, input: OptionCloseInput) =>
    invoke<OptionTrade>("mark_option_rolled", { id, input }),
  deleteOptionTrade: (id: number) =>
    invoke<void>("delete_option_trade", { id }),
  getOptionDashboard: () => invoke<OptionDashboard>("get_option_dashboard"),
};
