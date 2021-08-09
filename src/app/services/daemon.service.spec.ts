import { TestBed } from '@angular/core/testing';

import { DaemonService } from '../daemon/services/daemon.service';

describe('DaemonService', () => {
  let service: DaemonService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DaemonService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
