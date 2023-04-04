import { LokiQueryDirection } from "app/plugins/datasource/loki/dataquery.gen";

export interface RowContextOptions {
  direction?: LokiQueryDirection;
  limit?: number;
}
