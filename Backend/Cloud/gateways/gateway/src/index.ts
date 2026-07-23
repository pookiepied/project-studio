import { createGatewayApp } from "@/app/createGatewayApp";

const app = createGatewayApp();

export default {
  fetch: app.fetch
};
