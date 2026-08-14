import { eveChannel } from "eve/channels/eve";
import { httpBasic, localDev } from "eve/channels/auth";

export default eveChannel({
  auth: [
    localDev(),
    httpBasic({
      username: "helios",
      password: process.env["HELIOS_EVE_PASSWORD"] ?? ""
    })
  ]
});
