import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { StandingsComponent } from './standings/standings.component';
import { MatchupsComponent } from './matchups/matchups.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { TradesComponent } from './trades/trades.component';

export const routes: Routes = [
  { path: '',          component: HomeComponent },
  { path: 'standings', component: StandingsComponent },
  { path: 'matchups',  component: MatchupsComponent },
  { path: 'analytics', component: AnalyticsComponent },
  { path: 'trades',    component: TradesComponent },
  { path: '**',        redirectTo: '' },
];
