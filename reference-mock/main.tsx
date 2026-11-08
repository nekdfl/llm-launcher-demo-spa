// Entry функциональной копии SPA для `reference/`: тот же App поверх
// эмулированного backend'а. HashRouter — чтобы копия работала из file://.
import "../src/index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "../src/App";
import { startClock } from "./clock";
import "./handlers";
import { installMockServer } from "./server";

installMockServer();
startClock();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
