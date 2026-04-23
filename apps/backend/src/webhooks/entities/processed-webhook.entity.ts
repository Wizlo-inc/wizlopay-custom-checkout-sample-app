import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('processed_webhooks')
export class ProcessedWebhook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  webhookId: string;

  @CreateDateColumn()
  processedAt: Date;
}
