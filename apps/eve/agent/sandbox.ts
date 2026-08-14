import { defineSandbox } from "eve/sandbox";
import { hostSandbox } from "./lib/host-sandbox";

export default defineSandbox({
  backend: hostSandbox()
});
