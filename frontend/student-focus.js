(function (root) {
  class StudentFocus {
    constructor() { this.id = null; this.epoch = 0; this.pending = 0; this.changing = false; }
    ticket() { return { id: this.id, epoch: this.epoch }; }
    accepts(ticket) { return ticket.id === this.id && ticket.epoch === this.epoch && !this.changing; }
    async run(task) {
      if (this.changing || !this.id) throw new Error('请等待当前学生资料加载完成');
      this.pending++;
      try { return await task(); } finally { this.pending--; }
    }
    async change(task) {
      if (this.pending || this.changing) throw new Error('当前操作尚未完成，请完成后再切换学生');
      this.changing = true; this.epoch++;
      try { return await task(); } finally { this.changing = false; }
    }
    set(id) { this.id = id; this.epoch++; }
  }
  if (typeof module === 'object' && module.exports) module.exports = { StudentFocus };
  else root.StudentFocus = StudentFocus;
})(typeof window === 'undefined' ? globalThis : window);
