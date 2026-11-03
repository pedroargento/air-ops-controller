import { lightState } from './domain/public/light';
import { DEFAULT_SCENARIO_NAME, loadBundledScenario, scenarioNames } from './scenario/catalog';
import { skyOf } from './sim/weather';
import { renderScenarioMenu, type ScenarioCard } from './ui/scenario-menu';

/*
 * The entry point. A URL naming a scenario or a seed plays it; a bare one opens the scenario menu.
 * The URL stays the record of what's played: scenario and seed, shareable and replayable.
 */

const LAST_PLAYED = 'airops.lastScenario';

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_PLAYED);
  } catch {
    return null;
  }
}

function cards(): ScenarioCard[] {
  const names = [...scenarioNames()].sort((a, b) => (a === DEFAULT_SCENARIO_NAME ? -1 : b === DEFAULT_SCENARIO_NAME ? 1 : 0));
  return names.map((id) => {
    const { file } = loadBundledScenario(id);
    const models = file.air.models;
    return {
      id,
      name: file.name,
      summary: file.summary,
      objective: file.mission.briefing,
      startTime: file.startTime,
      light: lightState(skyOf(file), 0),
      durationSeconds: file.durationSeconds,
      aircraft: file.air.aircraft.map((entry) => models[entry.model]?.displayName.split(' ')[0] ?? entry.model),
    };
  });
}

const query = new URLSearchParams(location.search);
// A seed alone plays the default scenario, as older links did.
const chosen = query.get('scenario') ?? (query.has('seed') ? DEFAULT_SCENARIO_NAME : null);
if (chosen === null) {
  renderScenarioMenu(document.getElementById('scenario-menu') as HTMLElement, cards(), remembered());
} else {
  try {
    localStorage.setItem(LAST_PLAYED, chosen);
  } catch {
    // Without storage the menu just doesn't mark the last scenario played.
  }
  void import('./play');
}
