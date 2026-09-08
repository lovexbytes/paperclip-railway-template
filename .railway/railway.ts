import { defineRailway, project, service } from "railway/iac";

const paperclip = service("paperclip", {
  build: {
    builder: "DOCKERFILE",
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
    resources: [paperclip],
  }),
);