import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.demoMode});
  final bool demoMode;
  @override State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int index = 0;
  final money = NumberFormat.currency(locale: 'id_ID', symbol: 'Rp ', decimalDigits: 0);
  final titles = const ['Dashboard', 'Transaksi', 'Kasir', 'Laporan'];
  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(titles[index]), actions: widget.demoMode ? const [Padding(padding: EdgeInsets.only(right: 12), child: Center(child: Chip(label: Text('DEMO DATA'))))] : null),
    body: index == 0 ? _dashboard() : Center(child: Text('${titles[index]} siap dihubungkan ke Supabase.')),
    bottomNavigationBar: NavigationBar(selectedIndex: index, onDestinationSelected: (v) => setState(() => index = v), destinations: const [
      NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
      NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Transaksi'),
      NavigationDestination(icon: Icon(Icons.point_of_sale_outlined), selectedIcon: Icon(Icons.point_of_sale), label: 'Kasir'),
      NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Laporan'),
    ]),
  );
  Widget _dashboard() {
    final cards = [('Omzet Hari Ini', money.format(3250000), Icons.payments_outlined), ('Transaksi', '18', Icons.receipt_long_outlined), ('Kasbon Aktif', '7', Icons.credit_score_outlined), ('Saldo Kas', money.format(12750000), Icons.account_balance_wallet_outlined)];
    return ListView(padding: const EdgeInsets.all(16), children: [const Text('IRKOP Cell Business', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)), const SizedBox(height: 6), const Text('Ringkasan operasional hari ini'), const SizedBox(height: 16), GridView.builder(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), itemCount: cards.length, gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 1.25), itemBuilder: (_, i) { final x = cards[i]; return Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(x.$3), const Spacer(), Text(x.$1), Text(x.$2, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))]))); }), const SizedBox(height: 20), const Text('Transaksi Terbaru', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)), ...List.generate(8, (i) => Card(child: ListTile(leading: const CircleAvatar(child: Icon(Icons.receipt)), title: Text('TRX-DEMO-${1001 + i}'), subtitle: Text(i.isEven ? 'Tunai • Selesai' : 'Transfer • Terkonfirmasi'), trailing: Text(money.format(75000 + i * 125000))))]);
  }
}
