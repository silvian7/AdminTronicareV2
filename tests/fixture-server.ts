// Isolated test upstream. Never included in the production runtime image.
import express from "express";
import { fixtureTransport, fixtureRecord, wireRecord } from "./fixtures";
import { resourceMap } from "../shared/resources";
const { transport, records } = fixtureTransport();
records.set("organizations", [
  fixtureRecord(resourceMap.organizations, "7", {
    m_sLabel: "QA Organization",
  }),
]);
records.set("assets", [
  fixtureRecord(resourceMap.assets, "1", {
    m_sLabel: "QA Asset",
    m_sTag: "QA-001",
  }),
]);
const app = express();
app.use(express.text({ type: "*/*" }));
app.get("/health", (_req, res) => res.json({ synthetic: true }));
app.get("/v1/sensorshistory", (_req, res) => {
  res.setHeader("X-Tronicare-History-High-Water-Id", "42");
  res.setHeader("X-Tronicare-History-Snapshot", "synthetic-snapshot");
  res.json([
    {
      m_nIDSensorHistory: 42,
      m_nIDSensor: 1,
      m_dhDhLastEvent: "20260916103000",
      m_nValueInt: 21,
      m_bValueBool: false,
      m_rValueReal: 21.5,
    },
  ]);
});
app.use(async (req, res) => {
  const response = await transport(`http://fixture.invalid${req.originalUrl}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
  });
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(await response.text());
});
app.listen(4010, "0.0.0.0", () =>
  console.log("Synthetic test API listening on :4010; not for production."),
);
