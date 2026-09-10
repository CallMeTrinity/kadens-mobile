// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_initial.sql';
import m0001 from './0001_preference.sql';
import m0002 from './0002_auto_rest.sql';
import m0003 from './0003_app_version.sql';
import m0004 from './0004_exercise_language.sql';
import m0005 from './0005_silhouette.sql';
import m0006 from './0006_session_layout.sql';
import m0007 from './0007_session_lane.sql';
import m0008 from './0008_preference_theme.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008
    }
  }
  