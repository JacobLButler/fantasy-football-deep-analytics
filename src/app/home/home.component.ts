import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LeagueStateService } from '../services/league-state.service';

interface HubCard {
  title: string;
  description: string;
  icon: string;
  route: string;
  accent: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  readonly state = inject(LeagueStateService);

  readonly hubCards: HubCard[] = [
    {
      title: 'Standings',
      description: 'See where every team sits in the league rankings.',
      icon: '🏆',
      route: '/standings',
      accent: '#00c9b1',
    },
    {
      title: 'Matchups',
      description: 'Current week scores and head-to-head breakdowns.',
      icon: '🏈',
      route: '/matchups',
      accent: '#4f9eff',
    },
    {
      title: 'Analytics',
      description: 'Power rankings, schedule luck, consistency, and lineup efficiency.',
      icon: '📊',
      route: '/analytics',
      accent: '#a78bfa',
    },
    {
      title: 'Trades',
      description: 'Full trade history with players and picks exchanged.',
      icon: '💱',
      route: '/trades',
      accent: '#f59e0b',
    },
    {
      title: 'Waiver Wire',
      description: 'Track pickups, drops, and waiver activity.',
      icon: '📋',
      route: '/waivers',
      accent: '#34d399',
    },
    {
      title: 'League History',
      description: 'Championships, records, and all-time bragging rights.',
      icon: '📁',
      route: '/history',
      accent: '#f87171',
    },
  ];

  ngOnInit(): void {
    this.state.initialize();
  }
}
