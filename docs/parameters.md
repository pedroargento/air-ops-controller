# Rules parameters

Every value in `scenarios/rules/standard.json`, with what it does. A scenario file can override any of them,
and `npx tsx src/cli/batch.ts --set path=value` tries one without editing anything, for example
`--set combat.suppressionDecayPerUpdate=0.04`. This page is generated: run `npm run params` after changing the
rules or the schema.

## combat

| Parameter | Standard | What it does |
|---|---|---|
| `combat.squadSize` | `12` | Men per squad when a platoon divides (§4.0.1). |
| `combat.ambushSurpriseFactor` | `12` | Fire multiplier from a sprung ambush on a platoon nobody warned. |
| `combat.ambushSurpriseSeconds` | `45` | How long the surprise lasts. |
| `combat.columnSpacingMeters` | `40` | Gap between squads in column. |
| `combat.weapons.SMALL_ARMS.targetDomains` | `["GROUND","AIR"]` | What it can fire at: GROUND, AIR or both. |
| `combat.weapons.SMALL_ARMS.rangeMeters` | `350` | Maximum range. |
| `combat.weapons.SMALL_ARMS.suppressionEffect` | `0.1001` | Suppression each weapon adds per update at full effect. |
| `combat.weapons.SMALL_ARMS.damageEffect` | `0.01265` | Casualties each weapon causes per update at full effect. |
| `combat.weapons.SMALL_ARMS.crewRequired` | `1` | Men needed to work one. |
| `combat.weapons.SMALL_ARMS.ammunitionPerUse` | `1` | Rounds used per update of fire. |
| `combat.weapons.SMALL_ARMS.maxAltitudeMeters` | `150` | Highest aircraft it can reach. |
| `combat.weapons.SMALL_ARMS.airHitChance` | `0.01` | Chance per shot of hitting an aircraft, at best. |
| `combat.weapons.SMALL_ARMS.airCycleSeconds` | `30` | Seconds between shots at aircraft. |
| `combat.weapons.MACHINE_GUN.targetDomains` | `["GROUND","AIR"]` | What it can fire at: GROUND, AIR or both. |
| `combat.weapons.MACHINE_GUN.rangeMeters` | `350` | Maximum range. |
| `combat.weapons.MACHINE_GUN.suppressionEffect` | `0.572` | Suppression each weapon adds per update at full effect. |
| `combat.weapons.MACHINE_GUN.damageEffect` | `0.0253` | Casualties each weapon causes per update at full effect. |
| `combat.weapons.MACHINE_GUN.crewRequired` | `2` | Men needed to work one. |
| `combat.weapons.MACHINE_GUN.ammunitionPerUse` | `6` | Rounds used per update of fire. |
| `combat.weapons.MACHINE_GUN.maxAltitudeMeters` | `350` | Highest aircraft it can reach. |
| `combat.weapons.MACHINE_GUN.airHitChance` | `0.02` | Chance per shot of hitting an aircraft, at best. |
| `combat.weapons.MACHINE_GUN.airCycleSeconds` | `15` | Seconds between shots at aircraft. |
| `combat.weapons.AAA.targetDomains` | `["GROUND","AIR"]` | What it can fire at: GROUND, AIR or both. |
| `combat.weapons.AAA.rangeMeters` | `1500` | Maximum range. |
| `combat.weapons.AAA.suppressionEffect` | `0.4` | Suppression each weapon adds per update at full effect. |
| `combat.weapons.AAA.damageEffect` | `0.03` | Casualties each weapon causes per update at full effect. |
| `combat.weapons.AAA.crewRequired` | `3` | Men needed to work one. |
| `combat.weapons.AAA.ammunitionPerUse` | `4` | Rounds used per update of fire. |
| `combat.weapons.AAA.maxAltitudeMeters` | `2000` | Highest aircraft it can reach. |
| `combat.weapons.AAA.airHitChance` | `0.08` | Chance per shot of hitting an aircraft, at best. |
| `combat.weapons.AAA.airCycleSeconds` | `15` | Seconds between shots at aircraft. |
| `combat.weapons.MANPADS.targetDomains` | `["AIR"]` | What it can fire at: GROUND, AIR or both. |
| `combat.weapons.MANPADS.rangeMeters` | `2500` | Maximum range. |
| `combat.weapons.MANPADS.suppressionEffect` | `0` | Suppression each weapon adds per update at full effect. |
| `combat.weapons.MANPADS.damageEffect` | `0` | Casualties each weapon causes per update at full effect. |
| `combat.weapons.MANPADS.crewRequired` | `2` | Men needed to work one. |
| `combat.weapons.MANPADS.ammunitionPerUse` | `1` | Rounds used per update of fire. |
| `combat.weapons.MANPADS.maxAltitudeMeters` | `2500` | Highest aircraft it can reach. |
| `combat.weapons.MANPADS.airHitChance` | `0.3` | Chance per shot of hitting an aircraft, at best. |
| `combat.weapons.MANPADS.airCycleSeconds` | `90` | Seconds between shots at aircraft. |
| `combat.systemLossPerCasualtyFraction` | `1` | Chance that losses take a crew-served weapon with them. |
| `combat.assessmentNoise` | `0.5` | Error in a crew's casualty estimate after a strike. |
| `combat.suppressionFirePenalty` | `0.8` | How much suppression cuts a unit's own fire. |
| `combat.movingFirePenalty` | `0.5` | How much moving cuts a unit's fire. |
| `combat.minRangeFactor` | `0.25` | Effectiveness at maximum range, relative to point blank. |
| `combat.fireSpreadMeters` | `120` | Fire at a point hits whoever is near it, falling off over this distance. |
| `combat.suppressionDecayPerUpdate` | `0.08` | Share of suppression lost every 5-second update. |
| `combat.illuminationBelowLight` | `0.2` | A platoon fires illumination only where the light is below this. |
| `combat.illuminationRangeMeters` | `800` | Farthest a platoon fires an illumination round. |
| `combat.illuminationIntervalSeconds` | `240` | Shortest gap between one platoon's illumination rounds. |
| `combat.illuminationBurnSeconds` | `60` | How long an illumination round burns. |
| `combat.illuminationRadiusMeters` | `450` | How far an illumination round lights the ground. |
| `combat.illuminationLight` | `0.6` | Light under an illumination round, as a share of daylight. |
| `combat.moraleLossPerCasualtyFraction` | `1` | Morale lost per share of the platoon's strength lost. |
| `combat.moraleLossUnderFirePerUpdate` | `0.004` | Morale lost each update while under fire, down to the doctrine's floor. |
| `combat.moraleLossDeterioratingPerUpdate` | `0.002` | Extra loss each update when isolated or low on ammunition, below the floor. |
| `combat.isolationRadiusMeters` | `1000` | A platoon with no other friendly platoon this close is isolated. |
| `combat.lowAmmunitionFraction` | `0.15` | Below this share of ammunition a platoon's morale deteriorates. |
| `combat.moraleRecoveryOutOfContactPerUpdate` | `0.002` | Morale regained each update out of contact. |
| `combat.outOfContactSeconds` | `60` | Unhit this long counts as out of contact. |
| `combat.behaviorFireRate.observe` | `0.5` | Fire rate for each behaviour, as a share of full rate. |
| `combat.behaviorFireRate.probe` | `0.6` | Fire rate for each behaviour, as a share of full rate. |
| `combat.behaviorFireRate.harass` | `0.35` | Fire rate for each behaviour, as a share of full rate. |
| `combat.behaviorFireRate.assault` | `1` | Fire rate for each behaviour, as a share of full rate. |
| `combat.behaviorFireRate.disengage` | `0.5` | Fire rate for each behaviour, as a share of full rate. |
| `combat.moraleRecoveryPerUpdate` | `0.01` | Morale regained each update while recovering at the fallback. |
| `combat.moraleRecoveryCap` | `0.75` | Highest morale a platoon can recover to, before losses. |
| `combat.postureCover.moving` | `0` | Extra protection from each posture. |
| `combat.postureCover.firing` | `0.15` | Extra protection from each posture. |
| `combat.postureCover.defending` | `0.35` | Extra protection from each posture. |
| `combat.postureCover.prone` | `0.3` | Extra protection from each posture. |
| `combat.postureCover.hidden` | `0.35` | Extra protection from each posture. |
| `combat.fireReach` | `2.5` | Fire finds nobody beyond this many spreads from the aiming point. |

## perception

| Parameter | Standard | What it does |
|---|---|---|
| `perception.baseDetectionPerScan` | `0.9` | Chance to spot a target per 5-second scan, before modifiers. |
| `perception.movingBoost` | `1.5` | Spotting multiplier for a moving target. |
| `perception.firingBoost` | `3` | Spotting multiplier for a target that is firing. |
| `perception.trackedBoost` | `2` | Spotting multiplier for a target already being tracked. |
| `perception.postureConcealment.moving` | `0` | Concealment from each posture. |
| `perception.postureConcealment.firing` | `0` | Concealment from each posture. |
| `perception.postureConcealment.defending` | `0.2` | Concealment from each posture. |
| `perception.postureConcealment.prone` | `0.3` | Concealment from each posture. |
| `perception.postureConcealment.hidden` | `0.95` | Concealment from each posture. |
| `perception.hiddenAirConcealment` | `0.5` | Concealment of a hidden unit from the air, which is less than from the ground. |
| `perception.misidentifyChance` | `0.02` | Chance at full range that a crew takes friendly troops for hostile. |
| `perception.claimWindowSeconds` | `60` | A unit that fired this recently claims the men it sees fall. |
| `perception.claimOptimism` | `1.4` | How many it claims for each one that really fell: above 1 counts high, as units in a fight do. |
| `perception.claimNoise` | `0.3` | Spread of each claim, as a share of it. |
| `perception.claimAimMeters` | `120` | Only men falling this close to where a unit is firing count as its hits. |
| `perception.facingSeenPerScan` | `0.3` | Chance per scan that a crew sees which way a still squad faces. |
| `perception.facingNoiseRad` | `0.3` | Error in a seen facing. |
| `perception.reportCueBoost` | `10` | Spotting multiplier near a position a unit has been told about. |
| `perception.reportCueMeters` | `200` | How close to a reported position the cue applies. |
| `perception.identifyPerScan` | `0.6` | Chance per scan to identify a contact. |
| `perception.weaponSeenPerScan` | `0.1` | Chance per scan to make out a unit's weapons. |
| `perception.sigmaBaseMeters` | `15` | Position error of a sighting at point blank. |
| `perception.sigmaRangeFraction` | `0.08` | Extra position error per metre of range. |
| `perception.sigmaConcealmentFactor` | `1` | Extra error from concealment. |
| `perception.sigmaSuppressionFactor` | `1.5` | Extra error when the observer is suppressed. |
| `perception.observableFraction` | `0.5` | Share of a unit's men an observer can count. |
| `perception.strengthNoise` | `0.3` | Error in a strength estimate. |
| `perception.motionObservedPerScan` | `0.5` | Chance per scan to judge a moving contact's heading and speed. |
| `perception.headingNoiseRad` | `0.3` | Error in a judged heading. |
| `perception.contactMemorySeconds` | `120` | How long an unseen contact stays in a picture. |
| `perception.engageMemorySeconds` | `20` | How long after its last sighting a unit keeps firing at a contact. |
| `perception.revisionMoveMeters` | `50` | A contact that moved this far gets a new estimate. |
| `perception.revisionRangeImprovement` | `0.25` | A look this much closer gets a new estimate. |
| `perception.highConfidenceSigmaMeters` | `40` | Estimates this tight are high confidence. |
| `perception.mediumConfidenceSigmaMeters` | `90` | Estimates this tight are medium confidence. |
| `perception.navSigmaMeters` | `40` | Error in a unit's own reported position. |
| `perception.navDriftPerMeter` | `0.6` | How fast that error drifts as it moves. |

## radio

| Parameter | Standard | What it does |
|---|---|---|
| `radio.dangerCloseMeters` | `200` | A unit with the enemy this close asks for danger close. |
| `radio.prepareSeconds` | `15` | Time to prepare a report. |
| `radio.transmitSeconds` | `20` | Time to send one. |
| `radio.engagedRate` | `0.7` | Radio work rate while fighting. |
| `radio.withdrawingRate` | `0.5` | Radio work rate while withdrawing. |
| `radio.interruptSuppression` | `0.8` | At this suppression the radio stops. |
| `radio.positionIntervalSeconds` | `300` | Seconds between routine position reports. |
| `radio.ticCooldownSeconds` | `300` | Shortest gap between TICs. |
| `radio.supportRequestCooldownSeconds` | `300` | Shortest gap between support requests. |
| `radio.sitrepCasualtyStep` | `0.15` | Losses of this share trigger a SITREP. |
| `radio.sitrepIntervalSeconds` | `300` | Seconds between SITREPs in contact. |
| `radio.contactReportIntervalSeconds` | `120` | Seconds before the same contact is reported again. |
| `radio.ticRangeMeters` | `350` | Enemy within this distance can make a TIC. |
| `radio.markRangeMeters` | `400` | A platoon can mark a target with smoke for aircraft out to this distance. |
| `radio.ticStrengthRatio` | `1.2` | Declares a TIC against an enemy at least this many times its strength. |
| `radio.ticCasualtyFraction` | `0.1` | …or after losing this share. |
| `radio.supportStrengthRatio` | `1.5` | Asks for air against an enemy at least this many times its strength. |
| `radio.supportCasualtyFraction` | `0.2` | …or after losing this share. |
| `radio.supportAmmunitionFraction` | `0.25` | …or below this share of ammunition. |

## display

| Parameter | Standard | What it does |
|---|---|---|
| `display.opacityFloor` | `0.25` | Faintest a marker gets with age. |
| `display.fadeSeconds` | `900` | Seconds for a marker to fade. |
| `display.plausibleSpeedMps` | `1` | Fastest the map assumes an enemy moves, for joining reports. |
| `display.freshReportSeconds` | `120` | Reports this young count as fresh. |
| `display.clusterRadiusMeters` | `200` | Fresh reports this close are ringed as a cluster. |
| `display.reportBlinkSeconds` | `20` | How long a unit blinks after it is heard. |
| `display.repeatContactSeconds` | `300` | A contact report repeating one this recent is routine. |
| `display.repeatContactMeters` | `300` | …from this close. |
| `display.effectSeconds` | `40` | How long fire and strike effects show. |
| `display.groundFireMarkSeconds` | `900` | How long ground fire marks show. |
| `display.groundFireMergeMeters` | `300` | Ground fire reports this close merge. |
| `display.threatRiskPerMinute` | `0.1` | Threat rings are drawn where the chance of being hit is at least this per minute. |
| `display.archiveSeconds` | `1200` | Reports this old leave the map. |
| `display.destroyedShowSeconds` | `300` | How long a destroyed contact stays. |
| `display.notFoundShowSeconds` | `120` | How long a not-found contact stays. |
| `display.friendlySilentSeconds` | `600` | A friendly unit unheard this long shows as silent. |
| `display.staleSeconds` | `120` | A contact not seen for this long is drawn with a dashed frame and the time it was last seen. |
| `display.consolidateMaxAgeSeconds` | `120` | An aircraft sighting this fresh shows a unit is still near an old report, so the report isn't closed as not found. |
| `display.notFoundMinAgeSeconds` | `60` | A report must be this old before a clear look can close it. |
| `display.notFoundLookSeconds` | `60` | Seconds of clear look that close a report. |
| `display.notFoundCoverage` | `0.7` | A clear look covers a report only within this share of the sensor radius. |
| `display.summaryRatioRadiusMeters` | `1000` | Radius of the summary's force ratio. |
| `display.summaryStaleSeconds` | `600` | Reports older than this count as stale in the summary. |

## air

| Parameter | Standard | What it does |
|---|---|---|
| `air.operatingAltitudeMeters` | `650` | Shared default altitude. |
| `air.sensorReferenceHeightMeters` | `300` | Height at which sensors work at full quality. |
| `air.terrainLookaheadSeconds` | `8` | How far ahead pilots look for rising ground. |
| `air.sensorQualityMin` | `0.2` | Worst sensor quality from height. |
| `air.sensorQualityMax` | `1.3` | Best sensor quality from low down. |
| `air.groundFireSigmaMeters` | `150` | Error in a crew's estimate of where fire came from. |
| `air.groundFireWeaponSeenChance` | `0.5` | Chance a crew makes out the weapon firing at it. |
| `air.groundFireReportSeconds` | `60` | Shortest gap between a crew's reports of being fired on. |
| `air.models.O-1E.role` | `"recon"` | recon or cas. |
| `air.models.O-1E.displayName` | `"O-1E Bird Dog"` | Name shown to the player. |
| `air.models.O-1E.rotary` | `false` | True for a helicopter, which can hover. |
| `air.models.O-1E.terrainClearanceMeters` | `60` | Least height above the ground it flies. |
| `air.models.O-1E.defaultAltitudeMeters` | `650` | Its usual working height. |
| `air.models.O-1E.sensorFalloffMeters` | `1500` | Height over which its sensors lose quality. |
| `air.models.O-1E.strikeMissPerMeterAltitude` | `0` | Aiming error per metre of height. |
| `air.models.O-1E.passIntervalSeconds` | `120` | Shortest time between bombing passes. |
| `air.models.O-1E.casualtyFractionPerPass` | `0` | Share of men a bombing pass kills at full accuracy. |
| `air.models.O-1E.gunBursts` | `0` | Gun runs it carries. |
| `air.models.O-1E.flares` | `4` | Parachute flares it carries for lighting an area at night. |
| `air.models.O-1E.seats` | `0` | People it can pick up from the ground. |
| `air.models.O-1E.gunCasualtyFraction` | `0` | Share of men a gun run kills at full accuracy. |
| `air.models.O-1E.gunSuppression` | `0` | Suppression from a gun run. |
| `air.models.O-1E.suppressionPerPass` | `0` | Suppression from a bombing pass. |
| `air.models.O-1E.moralePerPass` | `0` | Morale shock from a pass. |
| `air.models.O-1E.hitChanceFactor` | `1.2` | Multiplier on ground fire's chance to hit it. |
| `air.models.O-1E.hitSurvivalChance` | `0` | Chance it survives a hit without damage. |
| `air.models.O-1E.speedMps` | `50` | Speed in metres per second. |
| `air.models.O-1E.fuelSeconds` | `16800` | Endurance. |
| `air.models.O-1E.ammunition` | `0` | Bombing passes it carries. |
| `air.models.O-1E.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.O-1E.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.O-1E.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.O-1E.bingoMarginSeconds` | `120` | Fuel kept in reserve for the trip home. |
| `air.models.O-1E.sensorRadiusMeters` | `1000` | How far it can see. |
| `air.models.O-1E.observerQuality` | `1.4` | Multiplier on its chance to spot. |
| `air.models.O-1E.orbitRadiusMeters` | `400` | Radius of its usual orbit. |
| `air.models.O-1E.turnRateRadPerSecond` | `0.5` | How fast it turns. |
| `air.models.O-1E.climbRateMps` | `5` | How fast it climbs or descends. |
| `air.models.O-1E.minAltitudeMeters` | `100` | Lowest altitude it can be given. |
| `air.models.O-1E.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.RF-101C.role` | `"recon"` | recon or cas. |
| `air.models.RF-101C.displayName` | `"RF-101C Voodoo"` | Name shown to the player. |
| `air.models.RF-101C.rotary` | `false` | True for a helicopter, which can hover. |
| `air.models.RF-101C.terrainClearanceMeters` | `60` | Least height above the ground it flies. |
| `air.models.RF-101C.defaultAltitudeMeters` | `650` | Its usual working height. |
| `air.models.RF-101C.sensorFalloffMeters` | `12000` | Height over which its sensors lose quality. |
| `air.models.RF-101C.strikeMissPerMeterAltitude` | `0` | Aiming error per metre of height. |
| `air.models.RF-101C.passIntervalSeconds` | `120` | Shortest time between bombing passes. |
| `air.models.RF-101C.casualtyFractionPerPass` | `0` | Share of men a bombing pass kills at full accuracy. |
| `air.models.RF-101C.gunBursts` | `0` | Gun runs it carries. |
| `air.models.RF-101C.flares` | `0` | Parachute flares it carries for lighting an area at night. |
| `air.models.RF-101C.seats` | `0` | People it can pick up from the ground. |
| `air.models.RF-101C.gunCasualtyFraction` | `0` | Share of men a gun run kills at full accuracy. |
| `air.models.RF-101C.gunSuppression` | `0` | Suppression from a gun run. |
| `air.models.RF-101C.suppressionPerPass` | `0` | Suppression from a bombing pass. |
| `air.models.RF-101C.moralePerPass` | `0` | Morale shock from a pass. |
| `air.models.RF-101C.hitChanceFactor` | `0.4` | Multiplier on ground fire's chance to hit it. |
| `air.models.RF-101C.hitSurvivalChance` | `0.1` | Chance it survives a hit without damage. |
| `air.models.RF-101C.speedMps` | `245` | Speed in metres per second. |
| `air.models.RF-101C.fuelSeconds` | `6000` | Endurance. |
| `air.models.RF-101C.ammunition` | `0` | Bombing passes it carries. |
| `air.models.RF-101C.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.RF-101C.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.RF-101C.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.RF-101C.bingoMarginSeconds` | `120` | Fuel kept in reserve for the trip home. |
| `air.models.RF-101C.sensorRadiusMeters` | `2000` | How far it can see. |
| `air.models.RF-101C.observerQuality` | `1` | Multiplier on its chance to spot. |
| `air.models.RF-101C.orbitRadiusMeters` | `1400` | Radius of its usual orbit. |
| `air.models.RF-101C.turnRateRadPerSecond` | `0.2` | How fast it turns. |
| `air.models.RF-101C.climbRateMps` | `30` | How fast it climbs or descends. |
| `air.models.RF-101C.minAltitudeMeters` | `100` | Lowest altitude it can be given. |
| `air.models.RF-101C.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.A-1E.role` | `"cas"` | recon or cas. |
| `air.models.A-1E.displayName` | `"A-1E Skyraider"` | Name shown to the player. |
| `air.models.A-1E.rotary` | `false` | True for a helicopter, which can hover. |
| `air.models.A-1E.terrainClearanceMeters` | `60` | Least height above the ground it flies. |
| `air.models.A-1E.defaultAltitudeMeters` | `650` | Its usual working height. |
| `air.models.A-1E.sensorFalloffMeters` | `4000` | Height over which its sensors lose quality. |
| `air.models.A-1E.strikeMissPerMeterAltitude` | `0.03` | Aiming error per metre of height. |
| `air.models.A-1E.passIntervalSeconds` | `120` | Shortest time between bombing passes. |
| `air.models.A-1E.casualtyFractionPerPass` | `0.25` | Share of men a bombing pass kills at full accuracy. |
| `air.models.A-1E.gunBursts` | `20` | Gun runs it carries. |
| `air.models.A-1E.flares` | `4` | Parachute flares it carries for lighting an area at night. |
| `air.models.A-1E.seats` | `0` | People it can pick up from the ground. |
| `air.models.A-1E.gunCasualtyFraction` | `0.12` | Share of men a gun run kills at full accuracy. |
| `air.models.A-1E.gunSuppression` | `0.6` | Suppression from a gun run. |
| `air.models.A-1E.suppressionPerPass` | `0.5` | Suppression from a bombing pass. |
| `air.models.A-1E.moralePerPass` | `0.15` | Morale shock from a pass. |
| `air.models.A-1E.hitChanceFactor` | `1` | Multiplier on ground fire's chance to hit it. |
| `air.models.A-1E.hitSurvivalChance` | `0.5` | Chance it survives a hit without damage. |
| `air.models.A-1E.speedMps` | `88` | Speed in metres per second. |
| `air.models.A-1E.fuelSeconds` | `9600` | Endurance. |
| `air.models.A-1E.ammunition` | `8` | Bombing passes it carries. |
| `air.models.A-1E.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.A-1E.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.A-1E.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.A-1E.bingoMarginSeconds` | `60` | Fuel kept in reserve for the trip home. |
| `air.models.A-1E.sensorRadiusMeters` | `800` | How far it can see. |
| `air.models.A-1E.observerQuality` | `1` | Multiplier on its chance to spot. |
| `air.models.A-1E.orbitRadiusMeters` | `400` | Radius of its usual orbit. |
| `air.models.A-1E.turnRateRadPerSecond` | `0.4` | How fast it turns. |
| `air.models.A-1E.climbRateMps` | `12` | How fast it climbs or descends. |
| `air.models.A-1E.minAltitudeMeters` | `100` | Lowest altitude it can be given. |
| `air.models.A-1E.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.F-100D.role` | `"cas"` | recon or cas. |
| `air.models.F-100D.displayName` | `"F-100D Super Sabre"` | Name shown to the player. |
| `air.models.F-100D.rotary` | `false` | True for a helicopter, which can hover. |
| `air.models.F-100D.terrainClearanceMeters` | `60` | Least height above the ground it flies. |
| `air.models.F-100D.defaultAltitudeMeters` | `650` | Its usual working height. |
| `air.models.F-100D.sensorFalloffMeters` | `4000` | Height over which its sensors lose quality. |
| `air.models.F-100D.strikeMissPerMeterAltitude` | `0.06` | Aiming error per metre of height. |
| `air.models.F-100D.passIntervalSeconds` | `90` | Shortest time between bombing passes. |
| `air.models.F-100D.casualtyFractionPerPass` | `0.4` | Share of men a bombing pass kills at full accuracy. |
| `air.models.F-100D.gunBursts` | `16` | Gun runs it carries. |
| `air.models.F-100D.flares` | `0` | Parachute flares it carries for lighting an area at night. |
| `air.models.F-100D.seats` | `0` | People it can pick up from the ground. |
| `air.models.F-100D.gunCasualtyFraction` | `0.12` | Share of men a gun run kills at full accuracy. |
| `air.models.F-100D.gunSuppression` | `0.6` | Suppression from a gun run. |
| `air.models.F-100D.suppressionPerPass` | `0.7` | Suppression from a bombing pass. |
| `air.models.F-100D.moralePerPass` | `0.25` | Morale shock from a pass. |
| `air.models.F-100D.hitChanceFactor` | `0.5` | Multiplier on ground fire's chance to hit it. |
| `air.models.F-100D.hitSurvivalChance` | `0.15` | Chance it survives a hit without damage. |
| `air.models.F-100D.speedMps` | `250` | Speed in metres per second. |
| `air.models.F-100D.fuelSeconds` | `3000` | Endurance. |
| `air.models.F-100D.ammunition` | `4` | Bombing passes it carries. |
| `air.models.F-100D.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.F-100D.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.F-100D.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.F-100D.bingoMarginSeconds` | `60` | Fuel kept in reserve for the trip home. |
| `air.models.F-100D.sensorRadiusMeters` | `2000` | How far it can see. |
| `air.models.F-100D.observerQuality` | `0.6` | Multiplier on its chance to spot. |
| `air.models.F-100D.orbitRadiusMeters` | `1200` | Radius of its usual orbit. |
| `air.models.F-100D.turnRateRadPerSecond` | `0.25` | How fast it turns. |
| `air.models.F-100D.climbRateMps` | `30` | How fast it climbs or descends. |
| `air.models.F-100D.minAltitudeMeters` | `100` | Lowest altitude it can be given. |
| `air.models.F-100D.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.UH-1B.role` | `"cas"` | recon or cas. |
| `air.models.UH-1B.displayName` | `"UH-1B Huey gunship"` | Name shown to the player. |
| `air.models.UH-1B.rotary` | `true` | True for a helicopter, which can hover. |
| `air.models.UH-1B.terrainClearanceMeters` | `15` | Least height above the ground it flies. |
| `air.models.UH-1B.defaultAltitudeMeters` | `450` | Its usual working height. |
| `air.models.UH-1B.sensorFalloffMeters` | `1500` | Height over which its sensors lose quality. |
| `air.models.UH-1B.strikeMissPerMeterAltitude` | `0.02` | Aiming error per metre of height. |
| `air.models.UH-1B.passIntervalSeconds` | `60` | Shortest time between bombing passes. |
| `air.models.UH-1B.casualtyFractionPerPass` | `0.1` | Share of men a bombing pass kills at full accuracy. |
| `air.models.UH-1B.gunBursts` | `30` | Gun runs it carries. |
| `air.models.UH-1B.flares` | `6` | Parachute flares it carries for lighting an area at night. |
| `air.models.UH-1B.seats` | `0` | People it can pick up from the ground. |
| `air.models.UH-1B.gunCasualtyFraction` | `0.08` | Share of men a gun run kills at full accuracy. |
| `air.models.UH-1B.gunSuppression` | `0.5` | Suppression from a gun run. |
| `air.models.UH-1B.suppressionPerPass` | `0.45` | Suppression from a bombing pass. |
| `air.models.UH-1B.moralePerPass` | `0.08` | Morale shock from a pass. |
| `air.models.UH-1B.hitChanceFactor` | `1.4` | Multiplier on ground fire's chance to hit it. |
| `air.models.UH-1B.hitSurvivalChance` | `0.3` | Chance it survives a hit without damage. |
| `air.models.UH-1B.speedMps` | `56` | Speed in metres per second. |
| `air.models.UH-1B.fuelSeconds` | `7200` | Endurance. |
| `air.models.UH-1B.ammunition` | `10` | Bombing passes it carries. |
| `air.models.UH-1B.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.UH-1B.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.UH-1B.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.UH-1B.bingoMarginSeconds` | `120` | Fuel kept in reserve for the trip home. |
| `air.models.UH-1B.sensorRadiusMeters` | `900` | How far it can see. |
| `air.models.UH-1B.observerQuality` | `1.1` | Multiplier on its chance to spot. |
| `air.models.UH-1B.orbitRadiusMeters` | `100` | Radius of its usual orbit. |
| `air.models.UH-1B.turnRateRadPerSecond` | `1` | How fast it turns. |
| `air.models.UH-1B.climbRateMps` | `8` | How fast it climbs or descends. |
| `air.models.UH-1B.minAltitudeMeters` | `30` | Lowest altitude it can be given. |
| `air.models.UH-1B.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.AH-1G.role` | `"cas"` | recon or cas. |
| `air.models.AH-1G.displayName` | `"AH-1G Cobra"` | Name shown to the player. |
| `air.models.AH-1G.rotary` | `true` | True for a helicopter, which can hover. |
| `air.models.AH-1G.terrainClearanceMeters` | `15` | Least height above the ground it flies. |
| `air.models.AH-1G.defaultAltitudeMeters` | `450` | Its usual working height. |
| `air.models.AH-1G.sensorFalloffMeters` | `1500` | Height over which its sensors lose quality. |
| `air.models.AH-1G.strikeMissPerMeterAltitude` | `0.02` | Aiming error per metre of height. |
| `air.models.AH-1G.passIntervalSeconds` | `45` | Shortest time between bombing passes. |
| `air.models.AH-1G.casualtyFractionPerPass` | `0.14` | Share of men a bombing pass kills at full accuracy. |
| `air.models.AH-1G.gunBursts` | `30` | Gun runs it carries. |
| `air.models.AH-1G.flares` | `0` | Parachute flares it carries for lighting an area at night. |
| `air.models.AH-1G.seats` | `0` | People it can pick up from the ground. |
| `air.models.AH-1G.gunCasualtyFraction` | `0.1` | Share of men a gun run kills at full accuracy. |
| `air.models.AH-1G.gunSuppression` | `0.55` | Suppression from a gun run. |
| `air.models.AH-1G.suppressionPerPass` | `0.5` | Suppression from a bombing pass. |
| `air.models.AH-1G.moralePerPass` | `0.1` | Morale shock from a pass. |
| `air.models.AH-1G.hitChanceFactor` | `1.1` | Multiplier on ground fire's chance to hit it. |
| `air.models.AH-1G.hitSurvivalChance` | `0.35` | Chance it survives a hit without damage. |
| `air.models.AH-1G.speedMps` | `77` | Speed in metres per second. |
| `air.models.AH-1G.fuelSeconds` | `7400` | Endurance. |
| `air.models.AH-1G.ammunition` | `12` | Bombing passes it carries. |
| `air.models.AH-1G.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.AH-1G.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.AH-1G.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.AH-1G.bingoMarginSeconds` | `120` | Fuel kept in reserve for the trip home. |
| `air.models.AH-1G.sensorRadiusMeters` | `900` | How far it can see. |
| `air.models.AH-1G.observerQuality` | `1.1` | Multiplier on its chance to spot. |
| `air.models.AH-1G.orbitRadiusMeters` | `100` | Radius of its usual orbit. |
| `air.models.AH-1G.turnRateRadPerSecond` | `1` | How fast it turns. |
| `air.models.AH-1G.climbRateMps` | `9` | How fast it climbs or descends. |
| `air.models.AH-1G.minAltitudeMeters` | `30` | Lowest altitude it can be given. |
| `air.models.AH-1G.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.OH-6A.role` | `"recon"` | recon or cas. |
| `air.models.OH-6A.displayName` | `"OH-6A Cayuse"` | Name shown to the player. |
| `air.models.OH-6A.rotary` | `true` | True for a helicopter, which can hover. |
| `air.models.OH-6A.terrainClearanceMeters` | `15` | Least height above the ground it flies. |
| `air.models.OH-6A.defaultAltitudeMeters` | `450` | Its usual working height. |
| `air.models.OH-6A.sensorFalloffMeters` | `800` | Height over which its sensors lose quality. |
| `air.models.OH-6A.strikeMissPerMeterAltitude` | `0` | Aiming error per metre of height. |
| `air.models.OH-6A.passIntervalSeconds` | `120` | Shortest time between bombing passes. |
| `air.models.OH-6A.casualtyFractionPerPass` | `0` | Share of men a bombing pass kills at full accuracy. |
| `air.models.OH-6A.gunBursts` | `0` | Gun runs it carries. |
| `air.models.OH-6A.flares` | `0` | Parachute flares it carries for lighting an area at night. |
| `air.models.OH-6A.seats` | `0` | People it can pick up from the ground. |
| `air.models.OH-6A.gunCasualtyFraction` | `0` | Share of men a gun run kills at full accuracy. |
| `air.models.OH-6A.gunSuppression` | `0` | Suppression from a gun run. |
| `air.models.OH-6A.suppressionPerPass` | `0` | Suppression from a bombing pass. |
| `air.models.OH-6A.moralePerPass` | `0` | Morale shock from a pass. |
| `air.models.OH-6A.hitChanceFactor` | `1.5` | Multiplier on ground fire's chance to hit it. |
| `air.models.OH-6A.hitSurvivalChance` | `0.4` | Chance it survives a hit without damage. |
| `air.models.OH-6A.speedMps` | `64` | Speed in metres per second. |
| `air.models.OH-6A.fuelSeconds` | `10000` | Endurance. |
| `air.models.OH-6A.ammunition` | `0` | Bombing passes it carries. |
| `air.models.OH-6A.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.OH-6A.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.OH-6A.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.OH-6A.bingoMarginSeconds` | `120` | Fuel kept in reserve for the trip home. |
| `air.models.OH-6A.sensorRadiusMeters` | `700` | How far it can see. |
| `air.models.OH-6A.observerQuality` | `1.5` | Multiplier on its chance to spot. |
| `air.models.OH-6A.orbitRadiusMeters` | `100` | Radius of its usual orbit. |
| `air.models.OH-6A.turnRateRadPerSecond` | `1` | How fast it turns. |
| `air.models.OH-6A.climbRateMps` | `8` | How fast it climbs or descends. |
| `air.models.OH-6A.minAltitudeMeters` | `30` | Lowest altitude it can be given. |
| `air.models.OH-6A.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.models.HH-3E.role` | `"recon"` | recon or cas. |
| `air.models.HH-3E.displayName` | `"HH-3E Jolly Green"` | Name shown to the player. |
| `air.models.HH-3E.rotary` | `true` | True for a helicopter, which can hover. |
| `air.models.HH-3E.terrainClearanceMeters` | `15` | Least height above the ground it flies. |
| `air.models.HH-3E.defaultAltitudeMeters` | `450` | Its usual working height. |
| `air.models.HH-3E.sensorFalloffMeters` | `1500` | Height over which its sensors lose quality. |
| `air.models.HH-3E.strikeMissPerMeterAltitude` | `0.02` | Aiming error per metre of height. |
| `air.models.HH-3E.passIntervalSeconds` | `60` | Shortest time between bombing passes. |
| `air.models.HH-3E.casualtyFractionPerPass` | `0` | Share of men a bombing pass kills at full accuracy. |
| `air.models.HH-3E.gunBursts` | `0` | Gun runs it carries. |
| `air.models.HH-3E.flares` | `0` | Parachute flares it carries for lighting an area at night. |
| `air.models.HH-3E.seats` | `4` | People it can pick up from the ground. |
| `air.models.HH-3E.gunCasualtyFraction` | `0` | Share of men a gun run kills at full accuracy. |
| `air.models.HH-3E.gunSuppression` | `0` | Suppression from a gun run. |
| `air.models.HH-3E.suppressionPerPass` | `0` | Suppression from a bombing pass. |
| `air.models.HH-3E.moralePerPass` | `0` | Morale shock from a pass. |
| `air.models.HH-3E.hitChanceFactor` | `1.4` | Multiplier on ground fire's chance to hit it. |
| `air.models.HH-3E.hitSurvivalChance` | `0.3` | Chance it survives a hit without damage. |
| `air.models.HH-3E.speedMps` | `70` | Speed in metres per second. |
| `air.models.HH-3E.fuelSeconds` | `7200` | Endurance. |
| `air.models.HH-3E.ammunition` | `0` | Bombing passes it carries. |
| `air.models.HH-3E.takeoffSeconds` | `60` | Time to get airborne. |
| `air.models.HH-3E.turnaroundSeconds` | `600` | Time to refuel and rearm. |
| `air.models.HH-3E.repairSeconds` | `1500` | Time to repair after damage. |
| `air.models.HH-3E.bingoMarginSeconds` | `120` | Fuel kept in reserve for the trip home. |
| `air.models.HH-3E.sensorRadiusMeters` | `700` | How far it can see. |
| `air.models.HH-3E.observerQuality` | `1.1` | Multiplier on its chance to spot. |
| `air.models.HH-3E.orbitRadiusMeters` | `100` | Radius of its usual orbit. |
| `air.models.HH-3E.turnRateRadPerSecond` | `1` | How fast it turns. |
| `air.models.HH-3E.climbRateMps` | `8` | How fast it climbs or descends. |
| `air.models.HH-3E.minAltitudeMeters` | `30` | Lowest altitude it can be given. |
| `air.models.HH-3E.maxAltitudeMeters` | `3000` | Highest altitude it can be given. |
| `air.groundNoticeRangeMeters` | `800` | How far ground units notice aircraft. |
| `air.groundNoticePerScan` | `0.5` | Chance per scan that a unit notices one. |
| `air.sightingDedupeMeters` | `400` | An air sighting this close to a known one isn't announced. |
| `air.cueRadiusMeters` | `200` | Recon cues CAS to contacts this close. |
| `air.cueMaxAgeSeconds` | `180` | Cues this old don't help. |
| `air.cueDetectionBoost` | `3` | Spotting multiplier from a cue. |
| `air.flareBurnSeconds` | `180` | How long a parachute flare burns. |
| `air.flareRadiusMeters` | `900` | How far a flare lights the ground around it. |
| `air.flareLight` | `0.7` | Light under a flare, as a share of daylight. |
| `air.boardSeconds` | `20` | Least time a person takes to get aboard a landed helicopter once beside it. |
| `air.boardMeters` | `25` | How close to a landed helicopter someone has to be to board. |
| `air.boardCallMeters` | `1500` | A survivor runs for a helicopter that lands within this distance of it. |
| `air.landingSpeedMps` | `8` | How fast a helicopter edges onto its pickup point before it lands. |
| `air.directionFindingErrorMeters` | `250` | How far off a hunter's fix on a survival radio is, typically. |
| `air.captureMeters` | `40` | Hunters this close to a survivor take it. |
| `air.landedHitFactor` | `8` | How many times easier a helicopter on the ground is to hit than one flying. |
| `air.markSeconds` | `120` | How long a smoke mark lasts. |
| `air.markIntervalSeconds` | `180` | Shortest gap between one platoon's marks. |
| `air.markErrorMeters` | `30` | How far smoke typically lands from where the platoon aimed it. |
| `air.markRadiusMeters` | `150` | Smoke helps a crew find targets, and warns the enemy, within this distance. |
| `air.markDetectionBoost` | `4` | Spotting multiplier for a crew looking near smoke. |
| `air.markIdentifyBoost` | `2` | Identification multiplier for a crew looking near smoke. |
| `air.blastRadiusMeters` | `120` | Distance over which aiming error spoils a bombing pass. |
| `air.strikeSplashMeters` | `70` | A bombing pass hits whoever is near the aiming point, falling off over this distance. |
| `air.gunSplashMeters` | `60` | Same for a gun run. |
| `air.gunRunHeightMeters` | `200` | Height of a gun run. |
| `air.releaseMeters` | `900` | Distance from the aiming point at which bombs are released. |
| `air.gunReleaseMeters` | `500` | Same for guns. |
| `air.gunPassFactor` | `0.4` | Gun runs can come this fraction of a bombing interval apart. |
| `air.pullOffSeconds` | `5` | Time spent pulling off after a pass. |
| `air.breakSeconds` | `45` | How long a crew flies away after breaking off. |
| `air.breakReactionSeconds` | `10` | Fire this recent can make a crew break off. |
| `air.breakDistanceMeters` | `1200` | How far away it heads when it breaks off. |
| `air.threatMemorySeconds` | `900` | How long a crew remembers where it was fired on. |
| `air.dangerCloseMeters` | `200` | Bombs need clearance within this distance of a friendly marker. |
| `air.gunDangerCloseMeters` | `100` | Guns need clearance within this distance. |
| `air.dangerCloseClearanceSeconds` | `300` | How long a danger close clearance lasts. |
| `air.dangerCloseHoldReportSeconds` | `60` | Shortest gap between a crew's holding reports. |
| `air.groundNoticeSigmaMeters` | `100` | Error in a ground unit's judgement of where an aircraft is. |
| `air.supportAckDistanceMeters` | `300` | CAS inbound needs a mission within this distance of the unit. |
| `air.supportGraceSeconds` | `180` | Extra time on a CAS inbound promise. |
| `air.supportEtaSlipSeconds` | `60` | An ETA change this large is sent to the unit. |
| `air.splashReach` | `2` | A pass hits nobody beyond this many splash distances. |
| `air.gunHeightTolerance` | `1.5` | A gun run can still fire this many times higher than planned. |
| `air.cloudMarginMeters` | `80` | How far below cloud a crew stays. |
| `air.rainSightShare` | `0.7` | Share of rain visibility a crew is willing to work at. |
| `air.threatStandoffMeters` | `900` | A crew stays off targets this close to where it was seriously fired on. |
| `air.searchReachedMeters` | `300` | A search leg is done within this distance. |
| `air.searchLegs` | `6` | Points in a recon search pattern. |
| `air.searchRingShare` | `0.65` | Search pattern radius, as a share of the area's. |
| `air.suppressSpreadShare` | `0.5` | How far from the center of a Suppress area the crew walks its fire, as a share of the area's radius. |
| `air.coverAheadMeters` | `400` | How far ahead of a covered platoon the aircraft watches, along its reported heading. |
| `air.jokerSeconds` | `600` | A crew calls JOKER when it has this much time left on station before it must head home. |
| `air.nightAttackLight` | `0.3` | Below this light a crew attacks only targets that are firing. |
| `air.darkDangerCloseFactor` | `1.5` | Danger close distances are this many times wider where it is dark. |

## weather

| Parameter | Standard | What it does |
|---|---|---|
| `weather.baseCeilingMeters` | `1600` | Cloud base away from storms. |
| `weather.minSystems` | `1` | Fewest storm systems in a run. |
| `weather.maxSystems` | `3` | Most storm systems. |
| `weather.minRadiusMeters` | `1500` | Smallest storm. |
| `weather.maxRadiusMeters` | `2600` | Largest storm. |
| `weather.minCeilingMeters` | `420` | Lowest storm cloud base. |
| `weather.maxCeilingMeters` | `640` | Highest storm cloud base. |
| `weather.minRain` | `0.4` | Lightest storm rain, 0 to 1. |
| `weather.maxRain` | `0.9` | Heaviest storm rain. |
| `weather.minWindMps` | `1` | Slowest storm movement. |
| `weather.maxWindMps` | `2.5` | Fastest storm movement. |
| `weather.minSystemSeconds` | `2000` | Shortest storm life. |
| `weather.maxSystemSeconds` | `3600` | Longest storm life. |
| `weather.rampSeconds` | `420` | Time for a storm to build and fade. |
| `weather.clearVisibilityMeters` | `8000` | Visibility in clear air. |
| `weather.heavyRainVisibilityMeters` | `300` | Visibility in the heaviest rain. |
| `weather.cloudFadeMeters` | `200` | Height over which cloud fades in below its base. |
| `weather.rainMissMeters` | `80` | Extra strike error in the heaviest rain. |
| `weather.starlight` | `0.03` | Light on a moonless night, as a share of daylight's usefulness for seeing and aiming. |
| `weather.fullMoonLight` | `0.25` | Extra light from a full moon that is up. |
| `weather.twilightSeconds` | `1800` | How long twilight lasts either side of sunrise and sunset. |
| `weather.cloudDimming` | `0.7` | Share of the night's light heavy rain and its cloud take away. |
| `weather.nightSightFloor` | `0.2` | Least sight reach in the dark, as a share of daylight's: movement seen by starlight. |
| `weather.flashSight` | `0.6` | Sight reach to a unit that is firing, however dark: its muzzle flashes give it away. |
| `weather.nightAimFloor` | `0.3` | Least effect of fire on men in the dark, as a share of daylight's. |
| `weather.forecastIntervalSeconds` | `1200` | Seconds between forecasts. |
| `weather.forecastWindErrorMps` | `0.35` | Forecast error in storm movement. |
| `weather.forecastPositionErrorMeters` | `120` | Forecast error in storm position. |
| `weather.forecastCeilingErrorMeters` | `80` | Forecast error in cloud base. |
| `weather.forecastTimingErrorSeconds` | `240` | Forecast error in timing. |

## doctrines

| Parameter | Standard | What it does |
|---|---|---|
| `doctrines.garrison.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.garrison.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.garrison.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.garrison.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.garrison.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.garrison.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.garrison.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.garrison.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.garrison.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.garrison.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.garrison.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.garrison.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.garrison.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.garrison.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.garrison.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.garrison.speedMps` | `0.8` | Walking speed in metres per second. |
| `doctrines.garrison.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.garrison.observerQuality` | `1` | Multiplier on its chance to spot and identify. |
| `doctrines.garrison.alertRadiusMeters` | `900` | Reports of enemy within this distance concern the unit. |
| `doctrines.garrison.avoidStrengthRatio` | `3` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.garrison.delayStrengthRatio` | `3` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.garrison.supportHoldBonus` | `0.4` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.garrison.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.garrison.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.garrison.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.garrison.illuminationRounds` | `8` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.garrison.standoffMeters` | `200` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.garrison.observeBias` | `0.2` | Weight towards observing when it meets an enemy. |
| `doctrines.garrison.probeBias` | `0` | Weight towards probing. |
| `doctrines.garrison.harassBias` | `0.5` | Weight towards harassing fire. |
| `doctrines.garrison.assaultBias` | `0.3` | Weight towards assaulting. |
| `doctrines.garrison.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.garrison.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.garrison.pressureMoraleFloor` | `0.2` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.garrison.airFireThreshold` | `0.5` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.garrison.engageRangeMeters` | `350` | Furthest it opens fire on the ground. |
| `doctrines.garrison.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.garrison.pinnedSuppression` | `0.8` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.garrison.withdrawCasualties` | `0.8` | Withdraws at this share of its strength lost. |
| `doctrines.garrison.withdrawMorale` | `0.1` | Withdraws when morale falls to this. |
| `doctrines.garrison.withdrawSuppression` | `1` | Withdraws when suppression reaches this. |
| `doctrines.garrison.returnMorale` | `0.4` | Returns to the fight once morale is back to this. |
| `doctrines.garrison.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.garrison.returnMaxCasualties` | `0.75` | Never returns having lost more than this share. |
| `doctrines.garrison.returnMinAmmoFraction` | `0.02` | Never returns with less than this share of its ammunition. |
| `doctrines.garrison.maxReturns` | `3` | How many times it can return to the fight. |
| `doctrines.garrison.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.garrison.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.garrison.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.garrison.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.garrison.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.garrison.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.garrison.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.garrison.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.garrison.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.patrol.drills` | `["nearAmbush","farAmbush","attack","bypass","hastyAmbush","waitForAir","pushThrough"]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.patrol.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.patrol.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.patrol.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.patrol.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.patrol.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.patrol.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.patrol.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.patrol.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.patrol.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.patrol.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.patrol.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.patrol.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.patrol.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.patrol.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.patrol.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.patrol.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.patrol.observerQuality` | `1.2` | Multiplier on its chance to spot and identify. |
| `doctrines.patrol.alertRadiusMeters` | `500` | Reports of enemy within this distance concern the unit. |
| `doctrines.patrol.avoidStrengthRatio` | `1.5` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.patrol.delayStrengthRatio` | `1.5` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.patrol.supportHoldBonus` | `0.3` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.patrol.reportMemorySeconds` | `900` | How long a received report stays in the unit's picture. |
| `doctrines.patrol.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.patrol.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.patrol.illuminationRounds` | `4` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.patrol.standoffMeters` | `300` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.patrol.observeBias` | `1` | Weight towards observing when it meets an enemy. |
| `doctrines.patrol.probeBias` | `0.3` | Weight towards probing. |
| `doctrines.patrol.harassBias` | `0.1` | Weight towards harassing fire. |
| `doctrines.patrol.assaultBias` | `0.1` | Weight towards assaulting. |
| `doctrines.patrol.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.patrol.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.patrol.pressureMoraleFloor` | `0.45` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.patrol.airFireThreshold` | `0.5` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.patrol.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.patrol.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.patrol.pinnedSuppression` | `0.6` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.patrol.withdrawCasualties` | `0.45` | Withdraws at this share of its strength lost. |
| `doctrines.patrol.withdrawMorale` | `0.35` | Withdraws when morale falls to this. |
| `doctrines.patrol.withdrawSuppression` | `0.8` | Withdraws when suppression reaches this. |
| `doctrines.patrol.returnMorale` | `0.6` | Returns to the fight once morale is back to this. |
| `doctrines.patrol.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.patrol.returnMaxCasualties` | `0.4` | Never returns having lost more than this share. |
| `doctrines.patrol.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.patrol.maxReturns` | `1` | How many times it can return to the fight. |
| `doctrines.patrol.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.patrol.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.patrol.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.patrol.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.patrol.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.patrol.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.patrol.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.patrol.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.patrol.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.assault.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.assault.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.assault.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.assault.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.assault.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.assault.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.assault.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.assault.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.assault.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.assault.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.assault.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.assault.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.assault.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.assault.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.assault.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.assault.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.assault.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.assault.observerQuality` | `0.9` | Multiplier on its chance to spot and identify. |
| `doctrines.assault.alertRadiusMeters` | `400` | Reports of enemy within this distance concern the unit. |
| `doctrines.assault.avoidStrengthRatio` | `3` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.assault.delayStrengthRatio` | `3` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.assault.supportHoldBonus` | `0` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.assault.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.assault.airCoverSeconds` | `30` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.assault.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.assault.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.assault.standoffMeters` | `150` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.assault.observeBias` | `0.1` | Weight towards observing when it meets an enemy. |
| `doctrines.assault.probeBias` | `0.1` | Weight towards probing. |
| `doctrines.assault.harassBias` | `0.2` | Weight towards harassing fire. |
| `doctrines.assault.assaultBias` | `1.5` | Weight towards assaulting. |
| `doctrines.assault.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.assault.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.assault.pressureMoraleFloor` | `0.3` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.assault.airFireThreshold` | `0.02` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.assault.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.assault.closesToMeters` | `40` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.assault.pinnedSuppression` | `0.7` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.assault.withdrawCasualties` | `0.6` | Withdraws at this share of its strength lost. |
| `doctrines.assault.withdrawMorale` | `0.25` | Withdraws when morale falls to this. |
| `doctrines.assault.withdrawSuppression` | `0.95` | Withdraws when suppression reaches this. |
| `doctrines.assault.returnMorale` | `0.45` | Returns to the fight once morale is back to this. |
| `doctrines.assault.returnSuppression` | `0.25` | …and suppression is down to this. |
| `doctrines.assault.returnMaxCasualties` | `0.55` | Never returns having lost more than this share. |
| `doctrines.assault.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.assault.maxReturns` | `3` | How many times it can return to the fight. |
| `doctrines.assault.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.assault.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.assault.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.assault.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.assault.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.assault.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.assault.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.assault.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.assault.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.harass.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.harass.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.harass.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.harass.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.harass.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.harass.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.harass.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.harass.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.harass.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.harass.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.harass.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.harass.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.harass.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.harass.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.harass.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.harass.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.harass.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.harass.observerQuality` | `0.9` | Multiplier on its chance to spot and identify. |
| `doctrines.harass.alertRadiusMeters` | `400` | Reports of enemy within this distance concern the unit. |
| `doctrines.harass.avoidStrengthRatio` | `3` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.harass.delayStrengthRatio` | `3` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.harass.supportHoldBonus` | `0` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.harass.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.harass.airCoverSeconds` | `30` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.harass.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.harass.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.harass.standoffMeters` | `250` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.harass.observeBias` | `0.3` | Weight towards observing when it meets an enemy. |
| `doctrines.harass.probeBias` | `0.2` | Weight towards probing. |
| `doctrines.harass.harassBias` | `1` | Weight towards harassing fire. |
| `doctrines.harass.assaultBias` | `0.2` | Weight towards assaulting. |
| `doctrines.harass.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.harass.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.harass.pressureMoraleFloor` | `0.45` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.harass.airFireThreshold` | `0.02` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.harass.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.harass.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.harass.pinnedSuppression` | `0.7` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.harass.withdrawCasualties` | `0.45` | Withdraws at this share of its strength lost. |
| `doctrines.harass.withdrawMorale` | `0.4` | Withdraws when morale falls to this. |
| `doctrines.harass.withdrawSuppression` | `0.95` | Withdraws when suppression reaches this. |
| `doctrines.harass.returnMorale` | `0.45` | Returns to the fight once morale is back to this. |
| `doctrines.harass.returnSuppression` | `0.25` | …and suppression is down to this. |
| `doctrines.harass.returnMaxCasualties` | `0.4` | Never returns having lost more than this share. |
| `doctrines.harass.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.harass.maxReturns` | `3` | How many times it can return to the fight. |
| `doctrines.harass.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.harass.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.harass.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.harass.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.harass.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.harass.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.harass.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.harass.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.harass.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.recon.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.recon.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.recon.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.recon.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.recon.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.recon.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.recon.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.recon.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.recon.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.recon.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.recon.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.recon.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.recon.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.recon.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.recon.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.recon.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.recon.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.recon.observerQuality` | `1.2` | Multiplier on its chance to spot and identify. |
| `doctrines.recon.alertRadiusMeters` | `500` | Reports of enemy within this distance concern the unit. |
| `doctrines.recon.avoidStrengthRatio` | `1.5` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.recon.delayStrengthRatio` | `1.5` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.recon.supportHoldBonus` | `0.3` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.recon.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.recon.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.recon.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.recon.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.recon.standoffMeters` | `300` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.recon.observeBias` | `0.8` | Weight towards observing when it meets an enemy. |
| `doctrines.recon.probeBias` | `1.5` | Weight towards probing. |
| `doctrines.recon.harassBias` | `0.1` | Weight towards harassing fire. |
| `doctrines.recon.assaultBias` | `0.1` | Weight towards assaulting. |
| `doctrines.recon.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.recon.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.recon.pressureMoraleFloor` | `0.45` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.recon.airFireThreshold` | `0.5` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.recon.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.recon.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.recon.pinnedSuppression` | `0.6` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.recon.withdrawCasualties` | `0.45` | Withdraws at this share of its strength lost. |
| `doctrines.recon.withdrawMorale` | `0.35` | Withdraws when morale falls to this. |
| `doctrines.recon.withdrawSuppression` | `0.8` | Withdraws when suppression reaches this. |
| `doctrines.recon.returnMorale` | `0.6` | Returns to the fight once morale is back to this. |
| `doctrines.recon.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.recon.returnMaxCasualties` | `0.4` | Never returns having lost more than this share. |
| `doctrines.recon.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.recon.maxReturns` | `2` | How many times it can return to the fight. |
| `doctrines.recon.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.recon.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.recon.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.recon.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.recon.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.recon.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.recon.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.recon.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.recon.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.antiair.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.antiair.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.antiair.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.antiair.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.antiair.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.antiair.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.antiair.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.antiair.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.antiair.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.antiair.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.antiair.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.antiair.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.antiair.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.antiair.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.antiair.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.antiair.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.antiair.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.antiair.observerQuality` | `1.2` | Multiplier on its chance to spot and identify. |
| `doctrines.antiair.alertRadiusMeters` | `500` | Reports of enemy within this distance concern the unit. |
| `doctrines.antiair.avoidStrengthRatio` | `1.5` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.antiair.delayStrengthRatio` | `1.5` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.antiair.supportHoldBonus` | `0.3` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.antiair.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.antiair.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.antiair.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.antiair.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.antiair.standoffMeters` | `100` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.antiair.observeBias` | `1` | Weight towards observing when it meets an enemy. |
| `doctrines.antiair.probeBias` | `0` | Weight towards probing. |
| `doctrines.antiair.harassBias` | `0` | Weight towards harassing fire. |
| `doctrines.antiair.assaultBias` | `0` | Weight towards assaulting. |
| `doctrines.antiair.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.antiair.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.antiair.pressureMoraleFloor` | `0.45` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.antiair.airFireThreshold` | `0.02` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.antiair.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.antiair.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.antiair.pinnedSuppression` | `0.6` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.antiair.withdrawCasualties` | `0.45` | Withdraws at this share of its strength lost. |
| `doctrines.antiair.withdrawMorale` | `0.35` | Withdraws when morale falls to this. |
| `doctrines.antiair.withdrawSuppression` | `0.8` | Withdraws when suppression reaches this. |
| `doctrines.antiair.returnMorale` | `0.6` | Returns to the fight once morale is back to this. |
| `doctrines.antiair.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.antiair.returnMaxCasualties` | `0.4` | Never returns having lost more than this share. |
| `doctrines.antiair.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.antiair.maxReturns` | `1` | How many times it can return to the fight. |
| `doctrines.antiair.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.antiair.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.antiair.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.antiair.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.antiair.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.antiair.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.antiair.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.antiair.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.antiair.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.column.drills` | `["nearAmbush","farAmbush","attack","bypass","hastyAmbush","pushThrough"]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.column.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.column.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.column.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.column.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.column.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.column.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.column.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.column.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.column.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.column.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.column.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.column.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.column.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.column.rallyMeters` | `300` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.column.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.column.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.column.observerQuality` | `1.2` | Multiplier on its chance to spot and identify. |
| `doctrines.column.alertRadiusMeters` | `500` | Reports of enemy within this distance concern the unit. |
| `doctrines.column.avoidStrengthRatio` | `1.5` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.column.delayStrengthRatio` | `1.5` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.column.supportHoldBonus` | `0.3` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.column.reportMemorySeconds` | `900` | How long a received report stays in the unit's picture. |
| `doctrines.column.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.column.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.column.illuminationRounds` | `6` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.column.standoffMeters` | `100` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.column.observeBias` | `0.3` | Weight towards observing when it meets an enemy. |
| `doctrines.column.probeBias` | `0.3` | Weight towards probing. |
| `doctrines.column.harassBias` | `0.4` | Weight towards harassing fire. |
| `doctrines.column.assaultBias` | `0.8` | Weight towards assaulting. |
| `doctrines.column.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.column.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.column.pressureMoraleFloor` | `0.3` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.column.airFireThreshold` | `0.5` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.column.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.column.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.column.pinnedSuppression` | `0.8` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.column.withdrawCasualties` | `0.65` | Withdraws at this share of its strength lost. |
| `doctrines.column.withdrawMorale` | `0.2` | Withdraws when morale falls to this. |
| `doctrines.column.withdrawSuppression` | `0.95` | Withdraws when suppression reaches this. |
| `doctrines.column.returnMorale` | `0.4` | Returns to the fight once morale is back to this. |
| `doctrines.column.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.column.returnMaxCasualties` | `0.6` | Never returns having lost more than this share. |
| `doctrines.column.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.column.maxReturns` | `3` | How many times it can return to the fight. |
| `doctrines.column.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.column.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.column.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.column.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.column.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.column.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.column.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.column.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.column.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.raider.drills` | `["nearAmbush","farAmbush","attack"]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.raider.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.raider.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.raider.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.raider.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.raider.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.raider.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.raider.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.raider.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.raider.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.raider.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.raider.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.raider.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.raider.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.raider.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.raider.speedMps` | `1` | Walking speed in metres per second. |
| `doctrines.raider.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.raider.observerQuality` | `0.9` | Multiplier on its chance to spot and identify. |
| `doctrines.raider.alertRadiusMeters` | `400` | Reports of enemy within this distance concern the unit. |
| `doctrines.raider.avoidStrengthRatio` | `3` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.raider.delayStrengthRatio` | `3` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.raider.supportHoldBonus` | `0` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.raider.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.raider.airCoverSeconds` | `30` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.raider.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.raider.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.raider.standoffMeters` | `150` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.raider.observeBias` | `0.1` | Weight towards observing when it meets an enemy. |
| `doctrines.raider.probeBias` | `0.1` | Weight towards probing. |
| `doctrines.raider.harassBias` | `0.2` | Weight towards harassing fire. |
| `doctrines.raider.assaultBias` | `1.5` | Weight towards assaulting. |
| `doctrines.raider.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.raider.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.raider.pressureMoraleFloor` | `0.3` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.raider.airFireThreshold` | `0.02` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.raider.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.raider.closesToMeters` | `40` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.raider.pinnedSuppression` | `0.7` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.raider.withdrawCasualties` | `0.6` | Withdraws at this share of its strength lost. |
| `doctrines.raider.withdrawMorale` | `0.25` | Withdraws when morale falls to this. |
| `doctrines.raider.withdrawSuppression` | `0.95` | Withdraws when suppression reaches this. |
| `doctrines.raider.returnMorale` | `0.45` | Returns to the fight once morale is back to this. |
| `doctrines.raider.returnSuppression` | `0.25` | …and suppression is down to this. |
| `doctrines.raider.returnMaxCasualties` | `0.55` | Never returns having lost more than this share. |
| `doctrines.raider.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.raider.maxReturns` | `3` | How many times it can return to the fight. |
| `doctrines.raider.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.raider.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.raider.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.raider.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.raider.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.raider.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.raider.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.raider.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.raider.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.evader.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.evader.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.evader.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.evader.radioSilent` | `true` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.evader.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.evader.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.evader.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.evader.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.evader.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.evader.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.evader.flankMeters` | `450` | How far to one side of the enemy flankers go before closing. |
| `doctrines.evader.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.evader.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.evader.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.evader.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.evader.speedMps` | `0.8` | Walking speed in metres per second. |
| `doctrines.evader.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.evader.observerQuality` | `1.2` | Multiplier on its chance to spot and identify. |
| `doctrines.evader.alertRadiusMeters` | `350` | Reports of enemy within this distance concern the unit. |
| `doctrines.evader.avoidStrengthRatio` | `1.5` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.evader.delayStrengthRatio` | `1.5` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.evader.supportHoldBonus` | `0.3` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.evader.reportMemorySeconds` | `300` | How long a received report stays in the unit's picture. |
| `doctrines.evader.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.evader.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.evader.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.evader.standoffMeters` | `300` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.evader.observeBias` | `0.8` | Weight towards observing when it meets an enemy. |
| `doctrines.evader.probeBias` | `1.5` | Weight towards probing. |
| `doctrines.evader.harassBias` | `0.1` | Weight towards harassing fire. |
| `doctrines.evader.assaultBias` | `0.1` | Weight towards assaulting. |
| `doctrines.evader.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.evader.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.evader.pressureMoraleFloor` | `0.45` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.evader.airFireThreshold` | `0.5` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.evader.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.evader.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.evader.pinnedSuppression` | `0.6` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.evader.withdrawCasualties` | `0.45` | Withdraws at this share of its strength lost. |
| `doctrines.evader.withdrawMorale` | `0.35` | Withdraws when morale falls to this. |
| `doctrines.evader.withdrawSuppression` | `0.8` | Withdraws when suppression reaches this. |
| `doctrines.evader.returnMorale` | `0.6` | Returns to the fight once morale is back to this. |
| `doctrines.evader.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.evader.returnMaxCasualties` | `0.4` | Never returns having lost more than this share. |
| `doctrines.evader.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.evader.maxReturns` | `2` | How many times it can return to the fight. |
| `doctrines.evader.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.evader.arrivedMeters` | `20` | Close enough to a point to count as there. |
| `doctrines.evader.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.evader.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.evader.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.evader.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.evader.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.evader.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.evader.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |
| `doctrines.hunter.drills` | `[]` | Battle drills this doctrine knows (§4.0.2). |
| `doctrines.hunter.airWaitSeconds` | `120` | How long a platoon holds for air before deciding without it. |
| `doctrines.hunter.waitForAirStrengthRatio` | `0.5` | Holds for air only for a position at least this strong against its own strength; weaker ones it deals with itself. |
| `doctrines.hunter.radioSilent` | `false` | Reports only when asked, as a downed aircrew saving its battery does. |
| `doctrines.hunter.airRefusedMemorySeconds` | `900` | After air operations says no air is available, it doesn't wait for air again for this long. |
| `doctrines.hunter.nearAmbushMeters` | `120` | Fire from inside this distance is a near ambush, so squads assault through; also the hasty ambush open-fire distance. |
| `doctrines.hunter.drillSeconds` | `600` | Every drill ends after this long, so none can hold a platoon forever. |
| `doctrines.hunter.attackStrengthRatio` | `1.5` | Attacks a known position up to this enemy-to-own strength ratio; above it, bypasses if it can. |
| `doctrines.hunter.maxDetourFactor` | `2` | Bypasses only if the way round is at most this many times the direct route. |
| `doctrines.hunter.supportShare` | `0.34` | Share of squads that give support by fire while the rest move. |
| `doctrines.hunter.flankMeters` | `200` | How far to one side of the enemy flankers go before closing. |
| `doctrines.hunter.warningMeters` | `700` | How far ahead on its route a platoon looks for known positions. |
| `doctrines.hunter.corridorMeters` | `180` | A position this close to the route counts as on it. |
| `doctrines.hunter.clearSeconds` | `60` | An enemy unseen this long counts as gone. |
| `doctrines.hunter.rallyMeters` | `null` | How far a platoon on the move pulls back before carrying on; null means to its authored fallback. |
| `doctrines.hunter.speedMps` | `0.6` | Walking speed in metres per second. |
| `doctrines.hunter.detectRangeMeters` | `500` | Furthest a unit can spot an enemy in clear weather. |
| `doctrines.hunter.observerQuality` | `0.5` | Multiplier on its chance to spot and identify. |
| `doctrines.hunter.alertRadiusMeters` | `500` | Reports of enemy within this distance concern the unit. |
| `doctrines.hunter.avoidStrengthRatio` | `1.5` | A patrol avoids a reported force at least this many times stronger. |
| `doctrines.hunter.delayStrengthRatio` | `1.5` | Without drills, a moving unit stops for a reported force at least this many times stronger. |
| `doctrines.hunter.supportHoldBonus` | `0.3` | How much longer a unit holds on when air support is promised, 0 to 1. |
| `doctrines.hunter.reportMemorySeconds` | `900` | How long a received report stays in the unit's picture. |
| `doctrines.hunter.airCoverSeconds` | `0` | How long a unit takes cover on spotting an enemy aircraft. |
| `doctrines.hunter.airCoverRepeatSeconds` | `300` | Shortest gap before it takes cover again for aircraft. |
| `doctrines.hunter.illuminationRounds` | `0` | Illumination rounds it can fire over an enemy at night. |
| `doctrines.hunter.standoffMeters` | `300` | Distance a cautious unit keeps from an enemy it observes. |
| `doctrines.hunter.observeBias` | `1` | Weight towards observing when it meets an enemy. |
| `doctrines.hunter.probeBias` | `0.3` | Weight towards probing. |
| `doctrines.hunter.harassBias` | `0.1` | Weight towards harassing fire. |
| `doctrines.hunter.assaultBias` | `0.1` | Weight towards assaulting. |
| `doctrines.hunter.burstSeconds` | `120` | How long a probe or harassing burst lasts. |
| `doctrines.hunter.pauseSeconds` | `180` | Pause between bursts. |
| `doctrines.hunter.pressureMoraleFloor` | `0.45` | Fire alone can't push morale below this; only losses, isolation or low ammunition can. |
| `doctrines.hunter.airFireThreshold` | `0.5` | Fires at an aircraft only if its chance of a hit is at least this. |
| `doctrines.hunter.engageRangeMeters` | `300` | Furthest it opens fire on the ground. |
| `doctrines.hunter.closesToMeters` | `null` | An assault closes to this distance; null means it doesn't close. |
| `doctrines.hunter.pinnedSuppression` | `0.6` | At this suppression a unit is pinned: it stops moving and goes prone. |
| `doctrines.hunter.withdrawCasualties` | `0.45` | Withdraws at this share of its strength lost. |
| `doctrines.hunter.withdrawMorale` | `0.35` | Withdraws when morale falls to this. |
| `doctrines.hunter.withdrawSuppression` | `0.8` | Withdraws when suppression reaches this. |
| `doctrines.hunter.returnMorale` | `0.6` | Returns to the fight once morale is back to this. |
| `doctrines.hunter.returnSuppression` | `0.3` | …and suppression is down to this. |
| `doctrines.hunter.returnMaxCasualties` | `0.4` | Never returns having lost more than this share. |
| `doctrines.hunter.returnMinAmmoFraction` | `0.1` | Never returns with less than this share of its ammunition. |
| `doctrines.hunter.maxReturns` | `1` | How many times it can return to the fight. |
| `doctrines.hunter.groupRadiusMeters` | `200` | Contacts this close together are one enemy, for reports and strength estimates. |
| `doctrines.hunter.arrivedMeters` | `25` | Close enough to a point to count as there. |
| `doctrines.hunter.sidestepMeters` | `60` | How far a support squad with no view moves to find one. |
| `doctrines.hunter.breakContactMeters` | `300` | How far a unit falls back to break contact with an enemy too close. |
| `doctrines.hunter.assaultAmmunitionFraction` | `0.25` | Below this share of ammunition a unit is less keen to assault. |
| `doctrines.hunter.noSupportWeaponsAssaultFactor` | `0.6` | Assault weight for a unit with no machine guns. |
| `doctrines.hunter.objectiveMarginMeters` | `60` | An attack counts as on its objective within the objective radius plus this. |
| `doctrines.hunter.attackRadiusMeters` | `100` | Size of the area an attack on a known position has to clear. |
| `doctrines.hunter.headingTowardsCos` | `0.5` | A moving enemy counts as coming towards the platoon within this cosine of its heading. |

## terrain

| Parameter | Standard | What it does |
|---|---|---|
| `terrain.cellSizeMeters` | `50` | Width of one terrain cell, in metres. |
| `terrain.elevationStepMeters` | `40` | Height of one step in the elevation layer, in metres. |
| `terrain.legend...terrainClass` | `"open"` | Name of the terrain class. |
| `terrain.legend...moveCost` | `1.2` | Movement cost multiplier: 1 is a road, higher is slower going. |
| `terrain.legend...groundCover` | `0.05` | Protection from ground fire, 0 to 1. |
| `terrain.legend...airCover` | `0.05` | Protection from air strikes, 0 to 1. |
| `terrain.legend...groundConcealment` | `0.1` | How hard it is to see a unit here from the ground, 0 to 1. |
| `terrain.legend...airConcealment` | `0.1` | How hard it is to see a unit here from the air, 0 to 1. |
| `terrain.legend...groundObstruction` | `0.02` | How much it blocks line of sight along the ground, 0 to 1. |
| `terrain.legend...airObstruction` | `0` | How much it blocks an aircraft's view of the ground, 0 to 1. |
| `terrain.legend.f.terrainClass` | `"forest"` | Name of the terrain class. |
| `terrain.legend.f.moveCost` | `1.8` | Movement cost multiplier: 1 is a road, higher is slower going. |
| `terrain.legend.f.groundCover` | `0.3` | Protection from ground fire, 0 to 1. |
| `terrain.legend.f.airCover` | `0.35` | Protection from air strikes, 0 to 1. |
| `terrain.legend.f.groundConcealment` | `0.45` | How hard it is to see a unit here from the ground, 0 to 1. |
| `terrain.legend.f.airConcealment` | `0.55` | How hard it is to see a unit here from the air, 0 to 1. |
| `terrain.legend.f.groundObstruction` | `0.2` | How much it blocks line of sight along the ground, 0 to 1. |
| `terrain.legend.f.airObstruction` | `0.2` | How much it blocks an aircraft's view of the ground, 0 to 1. |
| `terrain.legend.j.terrainClass` | `"jungle"` | Name of the terrain class. |
| `terrain.legend.j.moveCost` | `2.6` | Movement cost multiplier: 1 is a road, higher is slower going. |
| `terrain.legend.j.groundCover` | `0.4` | Protection from ground fire, 0 to 1. |
| `terrain.legend.j.airCover` | `0.55` | Protection from air strikes, 0 to 1. |
| `terrain.legend.j.groundConcealment` | `0.65` | How hard it is to see a unit here from the ground, 0 to 1. |
| `terrain.legend.j.airConcealment` | `0.8` | How hard it is to see a unit here from the air, 0 to 1. |
| `terrain.legend.j.groundObstruction` | `0.35` | How much it blocks line of sight along the ground, 0 to 1. |
| `terrain.legend.j.airObstruction` | `0.4` | How much it blocks an aircraft's view of the ground, 0 to 1. |
| `terrain.legend.o.terrainClass` | `"outpost"` | Name of the terrain class. |
| `terrain.legend.o.moveCost` | `1.2` | Movement cost multiplier: 1 is a road, higher is slower going. |
| `terrain.legend.o.groundCover` | `0.6` | Protection from ground fire, 0 to 1. |
| `terrain.legend.o.airCover` | `0.4` | Protection from air strikes, 0 to 1. |
| `terrain.legend.o.groundConcealment` | `0.2` | How hard it is to see a unit here from the ground, 0 to 1. |
| `terrain.legend.o.airConcealment` | `0.1` | How hard it is to see a unit here from the air, 0 to 1. |
| `terrain.legend.o.groundObstruction` | `0.05` | How much it blocks line of sight along the ground, 0 to 1. |
| `terrain.legend.o.airObstruction` | `0` | How much it blocks an aircraft's view of the ground, 0 to 1. |
| `terrain.legend.r.terrainClass` | `"road"` | Name of the terrain class. |
| `terrain.legend.r.moveCost` | `1` | Movement cost multiplier: 1 is a road, higher is slower going. |
| `terrain.legend.r.groundCover` | `0` | Protection from ground fire, 0 to 1. |
| `terrain.legend.r.airCover` | `0` | Protection from air strikes, 0 to 1. |
| `terrain.legend.r.groundConcealment` | `0.05` | How hard it is to see a unit here from the ground, 0 to 1. |
| `terrain.legend.r.airConcealment` | `0.05` | How hard it is to see a unit here from the air, 0 to 1. |
| `terrain.legend.r.groundObstruction` | `0` | How much it blocks line of sight along the ground, 0 to 1. |
| `terrain.legend.r.airObstruction` | `0` | How much it blocks an aircraft's view of the ground, 0 to 1. |
| `terrain.legend.w.terrainClass` | `"stream"` | Name of the terrain class. |
| `terrain.legend.w.moveCost` | `3` | Movement cost multiplier: 1 is a road, higher is slower going. |
| `terrain.legend.w.groundCover` | `0.1` | Protection from ground fire, 0 to 1. |
| `terrain.legend.w.airCover` | `0.1` | Protection from air strikes, 0 to 1. |
| `terrain.legend.w.groundConcealment` | `0.2` | How hard it is to see a unit here from the ground, 0 to 1. |
| `terrain.legend.w.airConcealment` | `0.2` | How hard it is to see a unit here from the air, 0 to 1. |
| `terrain.legend.w.groundObstruction` | `0.05` | How much it blocks line of sight along the ground, 0 to 1. |
| `terrain.legend.w.airObstruction` | `0` | How much it blocks an aircraft's view of the ground, 0 to 1. |
