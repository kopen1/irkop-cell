import 'package:flutter/material.dart';
import 'core/config/env.dart';
import 'features/home/home_page.dart';

class IrkopCellApp extends StatelessWidget {
  const IrkopCellApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'IRKOP Cell',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0B1F3A), primary: const Color(0xFF0B1F3A), secondary: const Color(0xFFD4AF37)),
      useMaterial3: true,
    ),
    home: HomePage(demoMode: !Env.isSupabaseConfigured),
  );
}
