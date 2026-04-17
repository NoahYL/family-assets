import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Holdings from "./pages/Holdings";
import Options from "./pages/Options";
import Trend from "./pages/Trend";
import Instruments from "./pages/Instruments";
import { cn } from "./lib/cn";

const nav = [
  { to: "/", label: "总览", end: true },
  { to: "/holdings", label: "持仓" },
  { to: "/options", label: "期权" },
  { to: "/accounts", label: "账户" },
  { to: "/instruments", label: "品种库" },
  { to: "/trend", label: "趋势" },
];

export default function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-slate-900 text-slate-300 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-white text-base font-semibold">家庭资产</div>
          <div className="text-xs text-slate-500 mt-0.5">Family Assets</div>
        </div>
        <nav className="flex-1 py-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "block px-5 py-2 text-sm transition",
                  isActive
                    ? "bg-slate-800 text-white border-l-2 border-blue-500"
                    : "hover:bg-slate-800/60 hover:text-white",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 text-xs text-slate-500 border-t border-slate-800">
          v0.1.0 · MVP
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/options" element={<Options />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/instruments" element={<Instruments />} />
          <Route path="/trend" element={<Trend />} />
        </Routes>
      </main>
    </div>
  );
}
