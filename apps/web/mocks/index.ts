// apps/web/mocks/index.ts — Typed mock datasets for UI testing (T9.4)
// Matches shared types from @seyvixa/shared without real API connection.

import procurement from "./procurement.json" with { type: "json" };
import quotes from "./quotes.json" with { type: "json" };
import suppliers from "./suppliers.json" with { type: "json" };
import agents from "./agents.json" with { type: "json" };
import grants from "./grants.json" with { type: "json" };
import decisions from "./decisions.json" with { type: "json" };
import budget from "./budget.json" with { type: "json" };
import action from "./action.json" with { type: "json" };
import settlement from "./settlement.json" with { type: "json" };

export {
  procurement,
  quotes,
  suppliers,
  agents,
  grants,
  decisions,
  budget,
  action,
  settlement,
};
