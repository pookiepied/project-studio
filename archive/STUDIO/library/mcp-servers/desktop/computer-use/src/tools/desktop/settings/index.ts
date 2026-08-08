export { getRegistryValue, setRegistryValue, listRegistryKeys, deleteRegistryValue,
         deleteRegistryKey }                                                         from "./registry.js";
export { listDisplays, getDisplaySettings, setDisplayResolution,
         setDisplayScaling, setDisplayOrientation }                                  from "./display.js";
export { listAudioDevices, getVolume, setVolume, toggleMute,
         setDefaultAudioDevice, setAppVolume }                                       from "./audio.js";
export { listPowerPlans, setPowerPlan, systemPowerAction }                           from "./power.js";
export { getFirewallStatus, listFirewallRules, addFirewallRule, removeFirewallRule } from "./firewall.js";
export { listEnvVars, setEnvVar, removeEnvVar }                                      from "./env-vars.js";
export { listInstalledApps, listStartupApps,
         getFileAssociation, setFileAssociation, manageStartupApp }                 from "./apps.js";
export { listScheduledTasks, manageScheduledTask, createScheduledTask }              from "./scheduler.js";
