export class ChatResponseDto {
  text!: string;
  data?: any;
  done!: boolean;
  type!: 'text' | 'data';
}

export class ChatChunk {
  type!: 'text' | 'data';
  data?: any;
  text?: string;
}
