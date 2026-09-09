import { defineRailway, postgres, project, service, volume } from "railway/iac";

const database = postgres("Postgres");
const paperclipData = volume("paperclip-data");

const paperclip = service("paperclip", {
  build: {
    builder: "DOCKERFILE",
  },
  variables: {
    DATABASE_URL: database.env.DATABASE_URL,
  },
  volumeMounts: {
    "/paperclip": paperclipData,
  },
  deploy: {
    numReplicas: 1,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 10,
    healthcheckPath: "/wrapper/healthz",
    healthcheckTimeout: 300,
  },
});

export default defineRailway(() =>
  project("paperclip-railway-template", {
    resources: [database, paperclipData, paperclip],
  }),
);
